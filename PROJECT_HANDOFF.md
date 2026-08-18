# 个人办公工作台 · 工程交接文档（Agent Handoff）

> 用途：本文档供其他 Agent / 开发者接手本项目继续开发时快速建立心智模型。
> 最后更新：2026-08-18 · 当前线上版本 **v9**
> 项目根目录：`D:\Cursor Project\WorkWrok\`
> 主交付物：`office-workbench.html`（单文件，1347 行，约 84 KB）

---

## 1. 项目概述

一个**纯前端、零依赖、可离线运行**的个人办公工作台，做成单个 HTML 文件。核心定位是「个人 GTD + 轻量项目管理 + 本地文件搜索预览」合一的桌面/移动端工具，数据全部存在浏览器 `localStorage`，通过「资料库」技能发布为公开在线页面。

**五大模块（导航 5 项）**
1. `today` 今日 — 逾期任务 / 今天待办 / 卡住项目 / 快速入口 + 清空示例入口
2. `todos` 待办 — 任务增删改、优先级、截止日、顺延、标签、关联项目
3. `notes` 灵感 — 卡片式笔记，支持标签、搜索
4. `projects` 项目（**统一页**，见 §5）— 项目 + 文件管理 + Everything 式搜索 + 即时预览
5. `review` 复盘 — 周完成 KPI、优先级甜甜圈、项目精力分布、7 日趋势、卡点汇总

> 历史上曾有第 6 项 `files`（本地文件搜索），已在 v8 合并进 `projects` 页并移除导航项。

---

## 2. 当前状态（截至 2026-08-18）

| 项 | 值 |
|---|---|
| 线上版本 | **v9** |
| 公开链接 | https://workbuddy.link/p/ybaXAwMV1cdkdktqMmCWBz |
| 最新事务ID | `tx_NqHaP1FB3dklwsWbiM7hr0`（v9） |
| 历史事务 | `tx_h5fs1SO40w0E9aq963KWlP`（v8） |
| 最严重历史 bug | v8 曾因初始化顺序触发 TDZ，导致「今日」页空白，已在 v9 修复（见 §7.2） |

**界面约定（来自早期多轮 UI 微调，已有肌肉记忆，勿轻易回退）**
- `.pill` 已设 `white-space:nowrap`、四周 `padding:10px`（用户明确要求，非固定高度）
- `.content` 已**移除** `max-width` 限制，卡片随浏览器宽度铺满
- 搜索框在输入时**不能被整页重绘打断焦点**（见 §6.2）

---

## 3. 核心架构

- **单文件 HTML**：`<style>` 内联全局 CSS，`<script>` 内联全部 JS，无任何 CDN / npm / 构建步骤。
- **离线可用**：直接双击 `office-workbench.html` 即可运行（除「资料库」发布外不依赖网络）。
- **持久化**：主数据 `localStorage["wb_office_workbench_v1"]`；文件文本预览单独存 `localStorage["wb_office_workbench_filecontent_v1"]`（避免撑爆主键 / 配额）。
- **无后端**：所有「搜索」「预览」均在浏览器内完成。图片/PDF 预览依赖当前会话内的 `File` 对象（刷新后失效，回退为「复制路径」）。
- **渲染模型**：`renderAll()` → 按 `cur` 派发到各 `renderXxx()`，整体重写 `#content` 的 `innerHTML`，再用 `bindXxxEvents()` 绑定事件。统一约定：`$ = id => document.getElementById(id)`。

---

## 4. 数据模型（state schema）

`load()` 返回的对象（`save()` 写回 localStorage）：

```js
state = {
  tasks: [            // 待办
    { id, text, done, priority:'high|medium|low', deadline:'YYYY-MM-DD'|null,
      deferCount, projectId|null, completedAt|null, tags:[] }
  ],
  notes: [ { id, title, body, tags:[], createdAt } ],
  projects: [        // 项目（v8 起直接携带 files）
    { id, name, followup, blocker, next,
      files: [       // 见下
        { id, name, path, size, mtime, ext, category:'agreement|accept|report|other' }
      ] }
  ],
  meta: { isSample:true|false }
}
```

**文件对象 `file`（projects[].files[]）**
```js
{ id, name, path, size, mtime, ext, category }
```
- `category` 由 `classifyFile(name)` 按文件名关键词自动判定：优先级 **技术协议(agreement) > 验收资料(accept) > 报告(report) > 其他(other)**。
- 文本内容索引在 `fileContent[fileId]`（独立 localStorage `KEY_FC`），会话内二进制在 `fileBlobs[fileId]`。

**localStorage 键**
| 键 | 含义 |
|---|---|
| `wb_office_workbench_v1` (常量 `KEY`) | 主状态 |
| `wb_office_workbench_files_v1` (常量 `KEY_FILES`) | **遗留键**，v7 前扁平文件格式；现已被 `migrateFileProjects()` 迁移并删除 |
| `wb_office_workbench_filecontent_v1` (常量 `KEY_FC`) | 文件文本预览 |

---

## 5. 统一「项目」页（projects）机制

这是本项目最有特色、也最易改坏的部分，单独说明。

**渲染层级**
```
renderProjects()          // 812 行：静态控制卡（一次性渲染）
  ├─ 创建项目表单 / 导入文件夹 / 导入多文件 / 清空全部
  ├─ Everything 搜索框（带清除按钮）+ 分类 chip + 排序下拉
  └─ <div id="lower"></div>
        │
renderLower()             // 863 行：只重绘 lower，保持搜索框焦点
  ├─ renderProjectResults()  // 1170 行：搜索命中时（文件名/路径/项目名/内容）
  └─ renderProjectList()     // 1100 行：正常列表（项目卡片→分类 pill→文件行）
```

**关键函数**
- `classifyFile(name)` 1070 — 自动归类
- `catLabel(id)` 1076 / `fIconInfo(ext)` 1077 / `fCat(ext)` 1086 — 分类/图标/底色
- `fmtSize(b)` 1093 / `fmtMtime(ms)` 1099 — 格式化
- `projFileRowHTML(f,pName)` 1131 — 单文件行（名称/路径高亮、内容片段、分类下拉、预览/复制按钮）
- `fileTreeBody(p)` 1152 — 项目内分类分组展开/收起
- `renderProjectResults()` 1170 — Everything 搜索：匹配 文件名/路径/项目名/文本内容，命中内容返回带 `<mark>` 高亮的片段；结果行设 `pvFids` 供预览上一/下一
- `bindFileRowEvents()` 1192 / `bindProjectEvents()` 1205 — 事件绑定（预览/复制/改分类/展开/删除/导入）
- `addFilesToProject(projName,root,arr)` 1052 — 建项目或追加文件

**文件导入**
- `#folderInput`（webkitdirectory）1275 行：选文件夹 → 以顶层目录名建项目 → 逐文件建 `file` 对象 + 存 `fileBlobs` + 文本类（≤2MB）读内容
- `#fileInput2`（multiple）1292 行：向指定项目追加多文件，按 `path` 去重

**即时预览**
- `openPreview(fid)` 1007（async）：建 `#previewModal`；文本内联 `<pre>` 高亮，图片/PDF 用 `URL.createObjectURL(fileBlobs[fid])`，历史/二进制回退为复制路径；含上一/下一
- `closePreview()` 1051

**内容搜索索引**
- `isTextExt(ext)` 994 — 可索引后缀白名单
- `readContent(fid,f)` 995 — FileReader 异步读文本，截断 `CONFIG.maxContentChars`（约 40k 字符）
- `getContent(fid)` 996 / `highlight(text,q)` 1002 / `contentSnippet(fid,q)` 1003
- `findFile(fid)` 1004 / `pruneContent()` 1005 — 删除孤儿索引

---

## 6. 两个易错核心约定（务必遵守）

### 6.1 初始化顺序 / Temporal Dead Zone（曾导致整页空白）
`let state` / `let fileContent` / `let fileBlobs` 等都用 `let` 声明。任何在声明行之前调用它们的代码都会抛 `Cannot access 'X' before initialization`，**脚本中断、页面空白**。

**正确顺序（见文件末尾 boot 区 1331–1344 行）**：
```js
state = load();
loadFileContent();
migrateFileProjects();
ensureProjectFiles();
seedSampleContent();
// linkSample IIFE（依赖 state.projects）
renderAll();
```
> 这些调用**必须**位于所有 `let/const` 与函数声明之后（即 `<script>` 末尾）。曾因把它放在文件顶部而触发 v8 空白 bug。

### 6.2 搜索框焦点不能被整页重绘打断
`#si`（搜索框）的 `oninput` 只调用 `renderLower()`（仅替换 `#lower` 内容），**绝不**调用 `renderProjects()` 整页重绘——否则每次按键焦点丢失。任何改搜索相关逻辑时都要沿用这个「静态控制卡 + 局部 lower 重绘」结构。

---

## 7. 函数地图（行号速查）

**工具/状态（546–565）**
`fmtDate`546 `todayStr`547 `addDays`548 `isOverdue`549 `isToday`550 `uid`551 `esc`552 `weekStart`553 `load`557 `save`561 `flashSaved`565

**视图渲染**
`sampleData`572 `counts`601 `renderNav`609 `renderBanner`622 `renderAll`639 `renderToday`651 `taskRow`691 `bindTaskRows`713 `toggleTask`721 `delTask`722 `deferTask`723 `renderTodos`726 `addRows`767 `allTags`771 `renderNotes`772 `renderProjects`812 `renderLower`863 `renderReview`887 `donut`948

**统一项目页 / 文件**
`renderProjectList`1100 `projFileRowHTML`1131 `fileTreeBody`1152 `renderProjectResults`1170 `bindFileRowEvents`1192 `bindProjectEvents`1205 `openPreview`1007 `closePreview`1051 `addFilesToProject`1052 `classifyFile`1070 `catLabel`1076 `fIconInfo`1077 `fCat`1086 `fmtSize`1093 `fmtMtime`1099

**文件内容索引**
`loadFileContent`972 `saveFileContent`973 `migrateFileProjects`974 `ensureProjectFiles`987 `seedSampleContent`988 `isTextExt`994 `readContent`995 `getContent`996 `highlight`1002 `contentSnippet`1003 `findFile`1004 `pruneContent`1005 `copyPath`1006

**导入导出/杂项**
`exportData`1220 `importData`1227 `totalItems`1243 `checkReminder`1244 `maybeClearSample`1257 `toast`1265

**boot 区（1271–1344）**
`cur='today'`1271；`#folderInput`/`#fileInput2` 绑定 1275/1292；`renderToday` 包装注入「清空示例」1312；状态初始化与 `renderAll` 1331–1344。

**常量（513–514 / 967–970）**
`KEY`513 `KEY_FILES`514 `KEY_FC`967 `fileBlobs`969 `fileContent`970；另有 `CONFIG`（maxContentChars / maxContentBytes）、`FILE_CATS`（分类定义）、`VIEWS`537、`I`（SVG 图标集，含 search/eye/x/chevronL/R）。

---

## 8. 部署流程（资料库 · 事务工作流）

发布/更新线上页面**必须**走「资料库」技能的事务接口（不能直接 FTP）。完整步骤：

1. **取 token**（client 模式每次需重新获取）：
   `DeferExecuteTool → connect_open_platform (skill_id:"library")`
   得到形如 `op_xxx` 的 token。
2. **建事务**（token 经 stdin 传入，避免明文）：
   ```bash
   printf '%s' "<TOKEN>" | python3 \
     "C:/Users/Jinkela/.workbuddy/plugins/cache/workbuddy-builtin/skill-library/0.5.9/page/create_page_transaction.py" \
     --token-stdin --node-id "ybaXAwMV1cdkdktqMmCWBz"
   # 返回 tx_xxx（记下，后续复用）
   ```
3. **取上传 URL**（10 分钟有效）：
   ```bash
   printf '%s' "<TOKEN>" | python3 \
     "C:/Users/Jinkela/.workbuddy/plugins/cache/workbuddy-builtin/skill-library/0.5.9/page/get_page_upload_url.py" \
     --token-stdin --transaction-id "<TX>" --path "office-workbench.html"
   ```
4. **直传 COS（curl PUT）**：
   ```bash
   curl -sS -X PUT --upload-file "D:/Cursor Project/WorkWrok/office-workbench.html" "<UPLOAD_URL>" \
     -w "HTTP %{http_code} size %{size_upload}\n"
   # 期望 HTTP 200
   ```
5. **提交事务**：
   ```bash
   printf '%s' "<TOKEN>" | python3 \
     "C:/Users/Jinkela/.workbuddy/plugins/cache/workbuddy-builtin/skill-library/0.5.9/page/commit_page_transaction.py" \
     --token-stdin --transaction-id "<TX>" --pnid "ybaXAwMV1cdkdktqMmCWBz" --message "改动说明"
   ```
6. **发布**：
   ```bash
   printf '%s' "<TOKEN>" | python3 \
     "C:/Users/Jinkela/.workbuddy/plugins/cache/workbuddy-builtin/skill-library/0.5.9/page/publish_page.py" \
     --token-stdin --node-id "ybaXAwMV1cdkdktqMmCWBz"
   ```

### 8.1 部署已知坑：COS 预签名 URL 偶发 403
后端签名有抖动，首次上传可能返回 **403**（尤其 `q-header-list` 未含 `host` 的旧 URL）。**解决**：重新跑 `get_page_upload_url.py` 拿一个新 URL（新版已把 `host` 纳入签名），再 `curl PUT`，一般立即 200。属偶发，重试即可，不必换事务。

---

## 9. 本地验证方法（推荐接手后先做）

可用 node + jsdom 在本地跑页面、捕获渲染异常，避免盲改上线：
```bash
# 安装（仅首次）
cd "C:/Users/Jinkela/.workbuddy/binaries/node/workspace"
"C:/Users/Jinkela/.workbuddy/binaries/node/versions/22.22.2/npm.cmd" install jsdom

# 抽出 <script> 语法校验
node -c office-workbench.html   # 注意：直接对 html 无效，需先提取 <script> 内容再 node --check

# jsdom 渲染各视图，捕获 window.onerror / 控制台报错
```
曾用此法验证 v9 的 Today / Projects 视图均无报错（约 4.2KB HTML 正常产出）。

---

## 10. 后续可优化点（供接手 agent 参考，非必须）

1. **文件内容搜索范围**：目前仅索引 `isTextExt` 白名单且 ≤2MB 的文本；PDF/Word/Docx 等二进制内容未解析（用户若期望「搜 docx 正文」需接入解析库，但会破坏零依赖）。
2. **预览持久化**：图片/PDF 预览依赖会话内 `File` 对象，刷新即失效；可考虑用 IndexedDB 存 Blob 以跨刷新（代价是存储体积与清理逻辑）。
3. **搜索性能**：全量遍历 `fileContent` 做 `indexOf`，文件多时（数千）可能卡；可加防抖 + 简单倒排。
4. **移动端**：已做基础适配，但统一项目页的「控制卡 + 树」在窄屏仍可进一步打磨。
5. **复盘数据**：目前按「本周」窗口统计，未做历史归档；可加按月/季度视图。
6. **多主题**：当前浅色一套，未做暗色（注意本机 IDE 主题联动非必须）。

---

## 11. 给接手 Agent 的 30 秒速查

- 改样式 → 找 `<style>`（在 `<head>` 内，约前 500 行）。
- 改某模块 → 直接搜 `function render<模块名>`（行号见 §7）。
- 改项目/文件/搜索/预览 → 重点看 §5，注意 §6.1 / §6.2 两条铁律。
- 改完要上线 → 走 §8 六步事务流程（先拿新 token）。
- 上线前 → 用 §9 的 jsdom 自检一次，确认无 `window.onerror`。
- 所有改动最终都会体现在同一文件 `office-workbench.html`，版本号 = 资料库发布的事务版本。

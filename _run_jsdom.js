const fs=require('fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('D:/Cursor Project/WorkWrok/office-workbench.html','utf8');
let errors=[];
const dom=new JSDOM(html,{
  runScripts:'dangerously',
  resources:'usable',
  url:'http://localhost/',
  beforeParse(window){
    window.addEventListener('error',e=>{errors.push('error: '+e.message);});
    window.console.error=(...args)=>errors.push('console.error: '+args.join(' '));
    window.console.log=(...args)=>console.log('log:',...args);
  }
});
setTimeout(()=>{
  const doc=dom.window.document;
  const content=doc.getElementById('content');
  console.log('content innerHTML length:',content?content.innerHTML.length:0);
  console.log('content text preview:',content?content.innerHTML.slice(0,500):'no content');
  console.log('errors:',errors);
  process.exit(0);
},500);

'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
function createLocalOcr({baseDir,userData}){
 let child=null,ready=null,serial=0,current=null,queued=null,buffer='';
 function close(){if(child)child.kill();child=null;ready=null;for(const job of [current,queued])if(job){clearTimeout(job.timer);job.reject(Error('Local OCR unavailable'));}current=queued=null;}
 function start(){if(ready)return ready;ready=new Promise((resolve,reject)=>{
  let configured;try{configured=JSON.parse(fs.readFileSync(path.join(baseDir,'assets/runtime-root.json'))).root;}catch{}
  const root=[configured,baseDir,process.env.PORTABLE_EXECUTABLE_DIR,process.env.PORTABLE_EXECUTABLE_DIR&&path.dirname(process.env.PORTABLE_EXECUTABLE_DIR),path.resolve(baseDir,'..','..')].filter(Boolean).find(r=>fs.existsSync(path.join(r,'.venv/Scripts/python.exe')));
  if(!root){ready=null;reject(Error('Local OCR runtime unavailable'));return;}
  fs.mkdirSync(userData,{recursive:true});const script=path.join(userData,'local-ocr-worker.py'),model=path.join(userData,'english-rec.onnx');
  fs.copyFileSync(path.join(baseDir,'scripts/local-ocr-worker.py'),script);const source=path.join(baseDir,'assets/ocr/english-rec.onnx');
  const expected=JSON.parse(fs.readFileSync(path.join(baseDir,'assets/ocr/model.json'))).sha256;const digest=p=>require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if(!fs.existsSync(model)||digest(model)!==expected)fs.copyFileSync(source,model);
  child=spawn(path.join(root,'.venv/Scripts/python.exe'),['-u',script,'--model',model],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});const worker=child;buffer='';
  const timer=setTimeout(()=>{close();reject(Error('Local OCR initialization timeout'));},12000);
  child.stdout.on('data',chunk=>{buffer+=chunk.toString('utf8');let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let item;try{item=JSON.parse(line);}catch{continue;}if(item.ready){clearTimeout(timer);resolve();pump();}else if(current&&item.id===current.id){const job=current;current=null;clearTimeout(job.timer);if(item.ok)job.resolve({...item,workerQueueMs:job.queueMs});else job.reject(Error('Local OCR failed'));pump();}}});
  worker.stdin.on('error',()=>{if(child===worker)close();});
  worker.on('error',()=>{clearTimeout(timer);reject(Error('Local OCR unavailable'));if(child===worker)close();});worker.on('exit',()=>{clearTimeout(timer);reject(Error('Local OCR stopped'));if(child===worker)close();});
 });return ready;}
 function pump(){if(current||!queued||!child)return;current=queued;queued=null;current.queueMs=Date.now()-current.enqueuedAt;current.timer=setTimeout(()=>close(),12000);child.stdin.write(JSON.stringify({id:current.id,image:current.image})+'\n');}
 async function read(image,signal){if(signal?.aborted)throw Object.assign(Error('Cancelled'),{name:'AbortError'});await start();if(signal?.aborted)throw Object.assign(Error('Cancelled'),{name:'AbortError'});return new Promise((resolve,reject)=>{
  const job={id:++serial,image,resolve,reject,enqueuedAt:Date.now()};if(queued)queued.reject(Object.assign(Error('Superseded'),{name:'AbortError'}));queued=job;
  const abort=()=>{if(queued===job)queued=null;reject(Object.assign(Error('Cancelled'),{name:'AbortError'}));};signal?.addEventListener('abort',abort,{once:true});
  job.resolve=value=>{signal?.removeEventListener('abort',abort);resolve(value);};job.reject=e=>{signal?.removeEventListener('abort',abort);reject(e);};pump();
 });}
 return{read,close};
}
module.exports={createLocalOcr};

const {app,BrowserWindow,nativeImage}=require('electron');
const review=process.argv.includes('--review');
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict');
const {execFile}=require('child_process');
app.setPath('userData',path.join(os.tmpdir(),'livedesk-split-ocr-test'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false}});
 const imagePath=path.join(os.tmpdir(),'livedesk-split-code-test.png');
 try{
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html><body style="margin:0;background:#12151a;color:#f1f2f3;font:24px Arial"><div style="position:absolute;left:40px;top:30px;width:1100px">${review ? 'Please review the JavaScript below and spot the issue.' : 'What does this function return for [1, 2, 3]?'}</div><div style="position:absolute;left:40px;top:130px">${review ? 'Explain the fix, not just what it does.' : 'Explain the result briefly.'}</div><pre style="position:absolute;left:600px;top:480px;font:24px Consolas">function doubleSum(values) {\n  ${review ? 'const' : 'let'} total = 0;\n  for (const v of values) {\n    total += v * 2;\n  }\n  return total;\n}</pre></body></html>`));
  await new Promise(r=>setTimeout(r,250));
  fs.writeFileSync(imagePath,(await win.webContents.capturePage()).toPNG());
  const output=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/screen-ocr.ps1'),'-ImagePath',imagePath],{windowsHide:true,timeout:12000,encoding:'utf8'},(e,out)=>e?reject(e):resolve(out)));
  const ocr=JSON.parse(output.trim().replace(/^\uFEFF/,''));
  const source=fs.readFileSync('main.js','utf8'),ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function questionFromOcr('),source.indexOf('async function readWindowsText(')),ctx);
  const task=ctx.taskFromOcr(ocr.lines);
  assert.match(task,review ? /spot the issue/ : /What does this function return/);
  assert.match(task,/return total/i);
  assert.match(task,/doublesum/i);
  console.log('PASS real Windows OCR retains top-of-screen question and code in separate lower pane');
  if (process.argv.includes('--answer') || review) {
    const config=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'LiveDesk AI','config.json'),'utf8'));
    const override=process.argv.find(arg=>arg.startsWith('--answer-model='));
    if(override) config.llm.model=override.split('=')[1];
    const image=fs.readFileSync(imagePath).toString('base64');
    const handlers=new Map();
    const native=vm.createContext({fetch,AbortController,AbortSignal,TextDecoder,console,process,nativeImage,visionController:null,readWindowsText:async()=>review?{text:ocr.text,lines:ocr.lines.filter(line=>line.y<300)}:ocr,taskFromOcr:ctx.taskFromOcr,seq:0,inflight:new Map(),friendlyNetworkError:e=>e.message,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}});
    vm.runInContext(source.slice(source.indexOf('function isOllamaEndpoint('),source.indexOf("ipcMain.handle('llm:abort'")),native);
    vm.runInContext(source.slice(source.indexOf("ipcMain.handle('vision:read'"),source.indexOf("ipcMain.handle('llm:models'")),native);
    const read=await handlers.get('vision:read')({}, {baseUrl:config.llm.baseUrl,model:config.screen.model,image:'data:image/png;base64,'+image,prompt:'Extract the entire coding question and code. Do not answer.',completeTask:true});
    assert.equal(read.ok,true,read.error);
    const extracted=read.text;
    assert.match(extracted,/total/);
    if(review) assert.match(extracted,/const total/);
    console.log('PASS real manual extraction includes lower JavaScript despite simulated OCR missing that pane');
    const prompt=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('src/renderer/llm.js','utf8'),prompt);
    config.behavior.context='';
    const messages=prompt.buildMessages(config,[],extracted);
    const user=messages.at(-1);user.content=[{type:'text',text:user.content},{type:'image_url',image_url:{url:'data:image/png;base64,'+image}}];
    let answer='';
    await new Promise((resolve,reject)=>{
      handlers.get('llm:chat')({sender:{isDestroyed:()=>false,send:(_channel,event)=>{
        if(event.type==='delta') answer+=event.text;
        if(event.type==='done')resolve();
        if(event.type==='error')reject(new Error(event.message));
      }}},{baseUrl:config.llm.baseUrl,payload:{model:config.llm.model,stream:true,temperature:0,max_tokens:350,messages}});
    });
    assert.match(answer,review ? /const|constant|reassign/i : /\b12\b/);
    if(review) assert.match(answer,/let/);
    console.log('PASS actual local screen reader and selected answer model solve split-layout code through native request handler: '+answer);
  }
  app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
 finally{win.destroy();try{fs.unlinkSync(imagePath);}catch{}}
});

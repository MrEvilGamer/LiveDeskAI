const {app,ipcMain,nativeImage}=require('electron');
const fs=require('fs'),path=require('path');
if(!process.argv.includes('--allow-sensitive-debug'))throw new Error('This legacy probe saves screen images. Use synthetic screen tests, or explicitly pass --allow-sensitive-debug.');
const diagnosticRoot='C:/Users/valen/Documents/Codex/2026-10-14/c-users-valen-desktop-livedeskai/work/capture-probe';
fs.mkdirSync(diagnosticRoot,{recursive:true});
const probeConfig=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'LiveDesk AI','config.json')));
const redacted=JSON.parse(JSON.stringify(probeConfig));for(const section of ['llm','stt'])if(redacted[section])redacted[section].apiKey='';
fs.writeFileSync(path.join(diagnosticRoot,'config.json'),JSON.stringify(redacted));
app.setPath('userData',diagnosticRoot);
const handlers=new Map();
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>{handlers.set(name,fn);handle(name,fn);};
require(process.argv.includes('--packaged') ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main.js');
app.whenReady().then(async()=>{
  try{
    await new Promise(r=>setTimeout(r,1500));
    if (process.argv.includes('--check-stt')) {
      const ready=await handlers.get('stt:ensure')();
      console.log('STT_READY '+JSON.stringify(ready));
      if(!ready || !ready.ok)throw new Error('Transcription startup failed');
    }
    let cap=await handlers.get('screen:capture')();
    const fixturePath=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
    if (fixturePath) {
      let fixture=nativeImage.createFromPath(fixturePath);
      if(process.argv.includes('--interview')) fixture=fixture.crop({x:0,y:1080,width:2560,height:1440});
      cap={ok:true,image:fixture.resize({width:1920}).toDataURL()};
    }
    if(!cap.ok)throw new Error(cap.error);
    fs.writeFileSync(path.join(diagnosticRoot,'capture.png'),Buffer.from(cap.image.split(',')[1],'base64'));
    console.log('CAPTURE '+path.join(diagnosticRoot,'capture.png'));
    const cfg=probeConfig;
    const vm=require('vm'),ctx=vm.createContext({window:{},location:{search:''},document:{querySelector:()=>null}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/overlay.js'),'utf8').replace('\ninit();','\n'),ctx);
    const read=await handlers.get('vision:read')({}, {baseUrl:cfg.llm.baseUrl,apiKey:cfg.llm.apiKey,model:cfg.screen.model,image:cap.image,prompt:vm.runInContext('SCREEN_PROMPT',ctx)});
    console.log(JSON.stringify({ok:read.ok,text:read.text,method:read.method,error:read.error}));
    app.exit(read.ok?0:1);
  }catch(e){console.error(e.message);app.exit(1);}
});

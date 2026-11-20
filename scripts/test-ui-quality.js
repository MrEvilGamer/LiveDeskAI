const {app,BrowserWindow}=require('electron');
const path=require('path'),assert=require('assert/strict');
app.setPath('userData',path.join(require('os').tmpdir(),'livedesk-ui-quality'));
app.whenReady().then(async()=>{
 try {
  const win=new BrowserWindow({show:false,width:480,height:720});
  for(const file of ['overlay.html','settings.html']) {
   await win.loadFile(path.join(__dirname,'../src',file),{search:'demo=1'});
   const cursors=await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button,input,textarea,label,p,span')).map(el=>getComputedStyle(el).cursor)`);
   assert.ok(cursors.length>0);assert.ok(cursors.every(c=>c==='default'));
   console.log('PASS arrow cursor across '+file);
  }
  win.destroy();app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});

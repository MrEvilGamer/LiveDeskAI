const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ctx=vm.createContext({console,Float32Array,ArrayBuffer,DataView,Uint8Array,performance,setTimeout,Promise});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/audio.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/renderer/live.js'),'utf8'),ctx);
ctx.signal=Float32Array.from({length:48000},(_,i)=>.2*Math.sin(2*Math.PI*12000*i/48000));
const wav=vm.runInContext('toWav16k(signal,48000)',ctx),view=new DataView(wav);
let energy=0;for(let i=200;i<15800;i++){const v=view.getInt16(44+i*2,true)/32768;energy+=v*v;}
assert.ok(Math.sqrt(energy/15600)<.01);console.log('PASS downsampling rejects high-frequency audio that previously aliased into speech');
const events=[];ctx.emit=t=>events.push(t);ctx.transcribe=async()=>({text:'Thank you.',speechVerified:true});
vm.runInContext(`const stream=new SpeechStream({interim:false,transcribe,onFinal:emit});stream.start(48000);stream.push(new Float32Array(24000).fill(.1));stream.end(24000,.09);`,ctx);
setTimeout(()=>{try{assert.equal(events[0],'Thank you.');console.log('PASS brief verified speech and genuine thank-you phrases survive filtering');}catch(e){console.error(e);process.exitCode=1;}},30);

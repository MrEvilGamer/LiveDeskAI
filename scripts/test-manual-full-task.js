const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('main.js','utf8');let payload;
const full='data:image/png;base64,full',lower='data:image/png;base64,lower';
const lines=[{text:'Explain the JavaScript below.',x:40,y:100},{text:'Spot each issue and explain the fix.',x:40,y:850},{text:'const total = 0;',x:40,y:900}];
const ctx=vm.createContext({process:{platform:'win32'},AbortController,AbortSignal,console,visionController:null,nativeImage:{createFromDataURL:()=>({getSize:()=>({width:1000,height:1000}),crop:()=>({toDataURL:()=>lower})})},fetch:async(_url,req)=>{payload=JSON.parse(req.body);return{ok:true,json:async()=>({message:{content:'Explain the JavaScript below.'}})};},readWindowsText:async()=>({text:'Question plus lower instructions',lines}),friendlyNetworkError:e=>e.message});
vm.runInContext(source.slice(source.indexOf('function questionFromOcr('),source.indexOf('async function readWindowsTile(')),ctx);
vm.runInContext(source.slice(source.indexOf('function isOllamaEndpoint('),source.indexOf('// Consume both supported streaming protocols')),ctx);
vm.runInContext(source.slice(source.indexOf('async function legacyVisionRead('),source.indexOf("ipcMain.handle('llm:models'")),ctx);
(async()=>{
 const result=await ctx.legacyVisionRead({}, {baseUrl:'http://localhost:11434/v1',model:'vision',image:full,prompt:'Extract the whole task.',completeTask:true});
 assert.equal(result.ok,true);assert.equal(payload.messages[0].images.length,2);assert.equal(payload.messages[0].images[0],'full');assert.equal(payload.messages[0].images[1],'lower');assert.match(result.text,/Spot each issue/);assert.match(result.text,/const total/);
 const {createReader}=require('../screen-pipeline');let modelCalls=0;
 const reader=createReader({ocr:async()=>({text:lines.map(l=>l.text).join('\n'),lines}),vision:async()=>{modelCalls++;return 'NO_TASK';}});
 const extracted=await reader.read({image:full});assert.ok(extracted.ok);assert.match(extracted.text,/const total/);assert.equal(modelCalls,0);
 const incomplete=createReader({ocr:async()=>({text:'Explain the JavaScript below.'}),vision:async()=> 'Explain the JavaScript below.'});assert.equal((await incomplete.read({image:full})).category,'INCOMPLETE_TASK');
 console.log('PASS complete OCR preserves lower code without vision; fallback preserves full image and lower crop; absent code is an explicit incomplete task');
})().catch(e=>{console.error(e);process.exitCode=1;});

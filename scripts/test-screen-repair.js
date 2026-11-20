const assert=require('assert/strict'),{createReader,analyze,mergeVisible}=require('../screen-pipeline');
const rows=t=>t.split('\n').map((text,i)=>({text,x:20,y:50+i*24,height:18}));
const task='Review the JavaScript below. Identify the bugs.\nconst total = 0;\nfor (let i = 0; i <= items.length; i++) {\n total += items[i];\n}\nreturn total;';
(async()=>{
 let calls=0,vision=0;const r=createReader({ocr:async()=>{calls++;return{text:task,lines:rows(task)};},vision:async()=>{vision++;return'NO_TASK';}});
 let a=await r.read({requestId:'1',image:'same'});assert.ok(a.ok);assert.match(a.text,/<= items.length/);assert.equal(vision,0);a=await r.read({requestId:'2',image:'same'});assert.ok(a.diagnostics.cacheHit);assert.equal(calls,1);
 assert.equal(analyze({text:'Given the sorted values 1, 4, 8, compute the median.'}).category,null);
 assert.equal(analyze({text:'Review the code below.'}).category,'INCOMPLETE_TASK');assert.equal(analyze({text:'const n = 1;'}).category,'INCOMPLETE_TASK');
 assert.equal(analyze({text:''}).category,'NO_READABLE_CONTENT');assert.equal(analyze({text:'Browser bookmarks and calendar'}).category,'NO_TASK');
 assert.equal(mergeVisible('Review the code below.\nconst n = 1;\nconst m = 2;','const n = 1;\nconst m = 2;\nreturn n + m;'),'Review the code below.\nconst n = 1;\nconst m = 2;\nreturn n + m;');
 assert.equal(mergeVisible('Question one?','Question two?'),'Question two?');
 let release;const slow=createReader({ocr:(_img,signal)=>new Promise(resolve=>{if(_img==='old')release=()=>resolve({text:task,lines:rows(task)});else resolve({text:'What is a queue?'});}),vision:async()=>''});
 const old=slow.read({requestId:'old',image:'old'});await new Promise(r=>setTimeout(r,0));const next=await slow.read({requestId:'new',image:'new'});release();assert.equal((await old).category,'CANCELLED');assert.equal(next.requestId,'new');assert.ok(next.ok);
 let first,second;const reused=createReader({ocr:image=>new Promise(resolve=>{if(image==='a')first=resolve;else second=resolve;}),vision:async()=>''});const one=reused.read({requestId:'same',image:'a'});await new Promise(r=>setTimeout(r,0));const two=reused.read({requestId:'same',image:'b'});await new Promise(r=>setTimeout(r,0));first({text:'What is a queue?'});assert.equal((await one).category,'CANCELLED');reused.cancel('same');second({text:'What is a stack?'});assert.equal((await two).category,'CANCELLED');
 const broken=createReader({ocr:async()=>{throw Error('private OCR content');},vision:async()=>{throw Error('private vision content');}});const failure=await broken.read({image:'x'});assert.equal(failure.category,'VISION_OCR_FAILURE');assert.ok(!JSON.stringify(failure.diagnostics).includes('private'));
 const timed=createReader({ocr:async()=>({text:'Review code below.'}),vision:async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});}});assert.equal((await timed.read({image:'x'})).category,'MODEL_TIMEOUT');
 console.log('PASS complete top/bottom extraction, exact cache, declarative tasks, incomplete and empty screens, overlapping scrolls, rapid cancellation, sanitized errors and timeout categories');
})().catch(e=>{console.error(e);process.exitCode=1;});

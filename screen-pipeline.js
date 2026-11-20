'use strict';
const {createHash}=require('crypto');
const {performance}=require('perf_hooks');
const labels={CAPTURE_FAILED:'Capture failed',WRONG_MONITOR:'Wrong monitor',NO_READABLE_CONTENT:'No readable content',NO_TASK:'No question found',INCOMPLETE_TASK:'Incomplete task',VISION_OCR_FAILURE:'Vision/OCR failure',UNSUPPORTED_CONTENT:'Unsupported content',MODEL_TIMEOUT:'Model timeout',CANCELLED:'Cancelled'};
const hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
function hasTaskIntent(text) {
 // Keep conversational forms at the start of a sentence or transcript line:
 // words such as "can" inside a navigation label do not establish a question.
 const passage = text.trim();
 const lines = passage.split(/\r?\n|[.!]\s+/).map(line => line.trim().replace(/^(?:(?:\d+[.)]|(?:question|q)\s*\d*[:.)-]|(?:interviewer|them|assistant)\s*:)\s*)+/i, ''));
 const question = /^(?:who|whom|whose|when|where|can|could|would|will|should|must|do|does|did|are|is|am|was|were|have|has|had)\b\s+(?!not\b)\S/i;
 const introduction = /^introduce\s+(?:yourself|yourselves)\b/i;
 const request = /^(?:introduce\s+(?:yourself|yourselves|your\b)|tell\s+(?:us|me)\b|(?:walk|talk)\s+(?:me|us)\s+through\b|give\s+(?:(?:me|us)\b|an?\s+example\b)|share\s+(?:your|an?|the)\b|name\s+(?:\d+|one|two|three|some|an?|the)\b|list\s+(?:\d+|the|some|your|examples)\b|summari[sz]e\b|outline\b)\s*\S/i;
 const greeting = /^(?:hello|hi|hey|good\s+(?:morning|afternoon|evening)|thank\s+you|thanks|nice\s+to\s+meet\s+you)(?:[,!\s]+(?:there|again|everyone|all))?[.!]*$/i;
 const singleDialogue = passage.replace(/^(?:interviewer|them|assistant)\s*:\s*/i, '');
 return /(?:\?|\b(?:task|given|scenario|exercise|spot|consider|evaluate|complete|implement|explain|describe|write|solve|calculate|compute|identify|review|find|fix|debug|compare|design|optimi[sz]e|analy[sz]e|what|why|how|which|please|tell me)\b)/i.test(passage)
   || lines.some(line => question.test(line) || introduction.test(line) || request.test(line))
   || greeting.test(singleDialogue);
}
function mergeVisible(previous,next){
 if(!previous)return next;
 const a=previous.trim().split('\n'),b=next.trim().split('\n'),key=s=>s.trim().replace(/\s+/g,' ');
 for(let n=Math.min(a.length,b.length);n>=2;n--)if(a.slice(-n).every((s,i)=>key(s)===key(b[i])))return a.concat(b.slice(n)).join('\n');
 if(!/[{};]|=>/.test(previous+next)){const x=previous.trim().split(/\s+/),y=next.trim().split(/\s+/);for(let n=Math.min(x.length,y.length);n>=6;n--)if(x.slice(-n).every((s,i)=>s.toLowerCase()===y[i].toLowerCase()))return x.concat(y.slice(n)).join(' ');}
 return next;
}
function analyze(ocr,{previousText='',width=0,height=0}={}){
 let lines=(ocr.lines||[]).filter(l=>l.text&&l.text.trim()&&!/^(live answer|live transcript|current screen|captured screen|settings updated)$/i.test(l.text.trim()));
 lines=lines.slice().sort((a,b)=>(a.y||0)-(b.y||0)||(a.x||0)-(b.x||0));
 const text=lines.length?lines.map(l=>' '.repeat(Math.min(36,Math.max(0,Math.round((l.x||0)/8))))+l.text.trim()).join('\n'):String(ocr.text||'').trim();
 const merged=mergeVisible(previousText,text);
 if(!merged.trim())return{category:'NO_READABLE_CONTENT',text:'',lineCount:lines.length};
 if(/^NO_TASK[.!]?$/i.test(merged.trim()))return{category:'NO_TASK',text:'',lineCount:lines.length};
 const instruction=hasTaskIntent(merged);
 const code=/(?:\b(?:const|let|var|function|def|class|return|SELECT|console\.log)\b|=>|[{}]|\w+\([^)]*\)\s*[;{])/.test(merged);
 const refersToCode=/\b(?:code|snippet|implementation|javascript|python|program|function)\b.{0,55}\b(?:below|following|shown|attached)\b|\b(?:below|following)\b.{0,45}\b(?:code|snippet|implementation|program)\b/i.test(merged);
 const lowConfidence=lines.some(l=>l.confidence!==undefined&&l.confidence<.88);
 const fragmentedConst=/^\s*const\s+[\w$]+\s*;?\s*$/m.test(merged);
 const braces=(merged.match(/{/g)||[]).length-(merged.match(/}/g)||[]).length;
 const edge=lines.some(l=>height&&l.height&&(l.y<=0||l.y+l.height>=height-2));
 if(!instruction)return{category:code?'INCOMPLETE_TASK':'NO_TASK',text:merged,lineCount:lines.length,hasCode:code,reason:code?'Show the task instructions as well as the code.':'No question or task was found in the visible text.'};
 if((refersToCode&&!code)||(code&&(braces!==0||fragmentedConst||lowConfidence))||edge||merged.length>32000)return{category:'INCOMPLETE_TASK',text:merged,lineCount:lines.length,hasCode:code,reason:'Supporting content may be below the viewport or clipped. Scroll with an overlapping passage and capture again.'};
 return{category:null,text:merged,lineCount:lines.length,hasCode:code};
}
// Bound the operation as well as its signal: adapters are not guaranteed to
// reject when aborted. Cancelled or late vision work must never hold a read open.
async function withDeadline(work,signal,timeoutMs){
 const phase=new AbortController();let timer,abort;
 const deadline=new Promise((_,reject)=>{
  abort=()=>{phase.abort(signal.reason);reject(Object.assign(new Error('Cancelled'),{name:'AbortError'}));};
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{const error=Object.assign(new Error('Screen reader deadline exceeded'),{name:'TimeoutError'});phase.abort(error);reject(error);},timeoutMs);
 });
 try{return await Promise.race([deadline,Promise.resolve().then(()=>{if(phase.signal.aborted)throw phase.signal.reason;return work(phase.signal);})]);}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
function createReader({ocr,vision,now=()=>performance.now(),timeoutMs=45000,retryDelayMs=15000}){
 let active=null,sequence=0;const cache=new Map();
 const cancel=id=>{if(active&&(!id||active.id===id))active.controller.abort();};
 async function read(req){
  cancel();const ticket=++sequence,controller=new AbortController(),id=req.requestId||('read-'+Date.now()+'-'+ticket);active={id,ticket,controller};const started=now(),stages=[];
  const stage=async(name,fn)=>{const t=now();try{const result=await fn();if(controller.signal.aborted)throw Object.assign(new Error('Cancelled'),{name:'AbortError'});stages.push({stage:name,ms:now()-t,status:'ok'});return result;}catch(e){stages.push({stage:name,ms:now()-t,status:controller.signal.aborted?'cancelled':'failed'});throw e;}};
  const finish=(category,details={})=>({...details,ok:!category,category,error:category?labels[category]+(details.reason?': '+details.reason:''):undefined,requestId:id,diagnostics:{requestId:id,totalMs:now()-started,stages,category:category||null,method:details.method||null,characters:(details.text||'').length,lineCount:details.lineCount||0,cacheHit:!!details.cacheHit,regionCacheHits:details.regionCacheHits||0,retryAfterMs:details.retryAfterMs||0}});
  const remember=(key,value,ttl)=>{cache.set(key,{until:Date.now()+ttl,value});while(cache.size>6)cache.delete(cache.keys().next().value);};
  try{
   const key=await stage('imageHash',async()=>hash(JSON.stringify([req.image,req.previousText||'',req.baseUrl||'',req.model||'',req.width||0,req.height||0]))); const cached=cache.get(key);
   if(cached&&cached.until>Date.now())return finish(cached.value.category,{...cached.value,cacheHit:true,...(cached.value.category==='MODEL_TIMEOUT'?{retryAfterMs:cached.until-Date.now()}: {})});
   if(cached)cache.delete(key);
   let raw,ocrError=false;
   try{raw=await stage('ocr',()=>ocr(req.image,controller.signal));}catch(e){if(controller.signal.aborted)throw e;ocrError=true;}
   if(raw?.preprocessingMs!==undefined)stages.push({stage:'imagePreprocessing',parent:'ocr',status:'ok',ms:raw.preprocessingMs},{stage:'ocrInference',parent:'ocr',status:'ok',ms:raw.ocrMs});
   if(raw?.workerQueueMs!==undefined)stages.push({stage:'ocrQueue',parent:'ocr',status:'ok',ms:raw.workerQueueMs});
   let task=await stage('classification',async()=>analyze(raw||{},{previousText:req.previousText,width:req.width,height:req.height}));
   if(!task.category){const result={...task,regionCacheHits:raw.regionCacheHits||0,recognizedText:raw.text,method:raw.backend||'Windows OCR'};remember(key,result,30000);return finish(null,result);}
   // A genuinely blank image cannot be improved by asking a model to invent a task.
   if(raw&&raw.blank)return finish('NO_READABLE_CONTENT',{...task,recognizedText:'',method:'Windows OCR'});
   let visionText;
   try{visionText=await stage('vision',()=>withDeadline(signal=>vision(req,signal,raw),controller.signal,timeoutMs));}
   catch(e){
    if(controller.signal.aborted)throw e;
    const timed=e.name==='TimeoutError'||/timed? ?out/i.test(e.message||'');
    const category=timed?'MODEL_TIMEOUT':e.category==='UNSUPPORTED_CONTENT'?'UNSUPPORTED_CONTENT':!ocrError&&task.category==='INCOMPLETE_TASK'?'INCOMPLETE_TASK':'VISION_OCR_FAILURE';
    const reason=timed?'The screen reader exceeded its deadline. Retry after the model is available.':category==='UNSUPPORTED_CONTENT'?'The selected screen model cannot process this image. Choose a vision-capable model in Settings.':task.reason;
    const result={...task,category,recognizedText:raw?.text||'',method:raw?.backend||'Windows OCR',reason,...(timed?{retryAfterMs:retryDelayMs}:{})};
    // Do not repeatedly submit the same failing frame every polling tick. A new
    // image/model remains eligible immediately, and incomplete OCR stays an error.
    if(timed&&retryDelayMs>0)remember(key,result,retryDelayMs);
    return finish(category,result);
   }
   const clean=String(visionText||'').trim();
   if(!clean)return finish('VISION_OCR_FAILURE',{...task,recognizedText:raw?.text||'',method:'Vision + OCR',reason:'The screen model returned no extracted text.'});
   if(/^NO_TASK[.!]?$/i.test(clean)){
    const category=task.category==='INCOMPLETE_TASK'?'INCOMPLETE_TASK':'NO_TASK';
    const result={...task,category,recognizedText:raw?.text||'',method:'Vision + OCR',reason:category==='NO_TASK'?'No question or task was found on the visible screen.':task.reason};
    if(category==='NO_TASK')remember(key,result,30000);
    return finish(category,result);
   }
   const readTask=analyze({text:clean},{previousText:req.previousText});
   // Require code actually transcribed, never a generic claim that code was visible.
   if(task.hasCode&&!readTask.hasCode)return finish('INCOMPLETE_TASK',{...task,recognizedText:raw?.text||'',method:'Windows OCR',reason:'Vision omitted code that OCR detected.'});
   const result={...readTask,recognizedText:raw?.text||'',method:'Vision + OCR'};
   if(readTask.category==='NO_TASK')remember(key,result,30000);
   return finish(readTask.category,result);
  }catch(e){return finish(controller.signal.aborted?'CANCELLED':e.name==='TimeoutError'?'MODEL_TIMEOUT':'VISION_OCR_FAILURE');}
  finally{if(active?.ticket===ticket)active=null;}
 }
 return{read,cancel};
}
module.exports={labels,hash,analyze,mergeVisible,createReader};

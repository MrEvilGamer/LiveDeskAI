const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const {evaluateCase,criticalErrors}=require('../src/coach/evaluator');
const root=path.resolve(__dirname,'..');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const phase=args.phase||'baseline';if(!['baseline','upgraded'].includes(phase))throw new Error('phase must be baseline or upgraded');
const bankPath=path.join(root,args.suite||'benchmarks/technical.json');
const bank=JSON.parse(fs.readFileSync(bankPath,'utf8')).cases;
const localConfig=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'LiveDesk AI','config.json'),'utf8'));
const model=args.model||localConfig.llm.model;
const endpoint=args.endpoint||'http://localhost:11434';if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint))throw new Error('Benchmark only permits a local Ollama endpoint');
const file=path.join(root,args.output||('benchmarks/results/'+phase+'.jsonl'));
fs.mkdirSync(path.dirname(file),{recursive:true});
const sourcePath=path.join(root,phase==='baseline'?'benchmarks/baseline/llm.js':'src/renderer/llm.js');
const source=fs.readFileSync(sourcePath,'utf8');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const ctx=vm.createContext({window:{},...(phase==='upgraded'?{TechnicalCoach:require('../src/coach/technical')}:{} )});vm.runInContext(source,ctx);
const done=new Set(fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(l=>{const x=JSON.parse(l);return x.caseId+'/'+x.style;}):[]);
const cfg={llm:{baseUrl:endpoint+'/v1',model,temperature:0.2,maxTokens:400},behavior:{mode:'interview',verbosity:'short',context:'No personal employment history, project implementation, or production metrics have been provided.'},screen:{model:''}};
async function generate(messages,maxTokens){
 const started=performance.now();let first=null,answer='',buffer='',reason='',usage={},serverError='';
 const res=await fetch(endpoint+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:true,think:false,keep_alive:'10m',options:{temperature:0.2,seed:42,num_predict:maxTokens,num_ctx:8192}}),signal:AbortSignal.timeout(90000)});
 if(!res.ok)throw new Error('HTTP '+res.status+' '+(await res.text()).slice(0,200));
 const reader=res.body.getReader(),decoder=new TextDecoder();
 const consume=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.error){serverError=item.error;return;}const text=item.message?.content;if(text){if(first===null)first=performance.now()-started;answer+=text;}if(item.done){reason=item.done_reason||'stop';usage={promptTokens:item.prompt_eval_count,outputTokens:item.eval_count,loadMs:(item.load_duration||0)/1e6,promptMs:(item.prompt_eval_duration||0)/1e6,decodeMs:(item.eval_duration||0)/1e6};}};
 for(;;){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let n;while((n=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(done){if(buffer.trim())consume(buffer);break;}}
 if(serverError)throw new Error(serverError);
 return{answer,firstTokenMs:first,totalMs:performance.now()-started,finishReason:reason||'connection_closed',...usage};
}
(async()=>{
 const metaFile=file+'.meta.json';
 const metadata={phase,model,endpoint,sourceSha256:hash(source),retrievalSha256:phase==='upgraded'?hash(fs.readFileSync(path.join(root,'src/coach/technical.js'))):null,knowledgeSha256:phase==='upgraded'?hash(fs.readFileSync(path.join(root,'src/coach/knowledge.js'))):null,benchmarkSha256:hash(fs.readFileSync(bankPath)),node:process.version,startedAt:new Date().toISOString(),styles:['short','extended'],seed:42,temperature:.2,contextTokens:8192,existing:done.size};
 if(fs.existsSync(metaFile)){const old=JSON.parse(fs.readFileSync(metaFile));for(const key of ['model','sourceSha256','benchmarkSha256','knowledgeSha256',...(phase==='upgraded'?['retrievalSha256']:[])])if(old[key]!==metadata[key])throw new Error('Resume metadata mismatch: '+key);}
 else{try{metadata.ollama=await(await fetch(endpoint+'/api/version')).json();const tags=await(await fetch(endpoint+'/api/tags')).json();metadata.modelDetails=tags.models.find(m=>m.name===model);}catch{}fs.writeFileSync(metaFile,JSON.stringify(metadata,null,2));}
 if(!done.size)await generate([{role:'user',content:'Reply with OK.'}],8);
 let completed=done.size;
 for(const testCase of bank){for(const style of ['short','extended']){
  if(done.has(testCase.id+'/'+style))continue;
  cfg.behavior.verbosity=style==='short'?'short':'long';
  const preparedAt=performance.now();
  const messages=ctx.buildMessages(cfg,[],testCase.question,testCase.context||[]);
  const preparationMs=performance.now()-preparedAt;
  const memoryBefore=process.memoryUsage().rss;
  let generated;try{generated=await generate(messages,style==='short'?180:420);}catch(e){generated={answer:'',error:e.message,firstTokenMs:null,totalMs:null,finishReason:'error'};}
  const raw=generated.answer;let answer=raw,correctionApplied=false;
  if(phase==='upgraded'){
   const findings=criticalErrors(raw,require('../src/coach/technical').retrieve(testCase.question),testCase.question);
   if(findings.length){answer=require('../src/coach/technical').correction(testCase.question,findings);correctionApplied=true;}
  }
  const evaluation=evaluateCase(testCase,answer,{finishReason:generated.finishReason,style});
  const record={caseId:testCase.id,domain:testCase.domain,style,phase,model,...generated,rawAnswer:raw,answer,correctionApplied,evaluation,runnerRssBytes:memoryBefore,preparationMs,promptCharacters:messages.reduce((n,m)=>n+m.content.length,0),at:new Date().toISOString()};
  if(completed%10===0){try{const ps=await(await fetch(endpoint+'/api/ps')).json();record.modelResources=ps.models.map(m=>({name:m.name,sizeBytes:m.size,vramBytes:m.size_vram}));}catch{}}
  fs.appendFileSync(file,JSON.stringify(record)+'\n');completed++;
  if(completed%10===0)console.log(JSON.stringify({phase,completed,total:bank.length*2,last:testCase.id,style,score:evaluation.score,ttftMs:Math.round(generated.firstTokenMs||0),totalMs:Math.round(generated.totalMs||0)}));
 }}
 console.log(JSON.stringify({phase,completed,finished:true,file}));
})().catch(e=>{console.error(e);process.exitCode=1;});

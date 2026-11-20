const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
async function scenario(alwaysEcho=false,supersede=false){
 const timers=[],requests=[],shown=[];
 const element={classList:{add(){},remove(){}},textContent:''};
 const ctx=vm.createContext({window:{liveDesk:{}},location:{search:''},document:{querySelector:()=>element},performance,Date,console,setTimeout:fn=>timers.push(fn),clearTimeout(){},buildMessages:()=>[{role:'system',content:'Answer directly.'},{role:'user',content:'What is a tuple?'}],askLLM:(_cfg,messages,token,done,error)=>{
  requests.push(messages);
  if(requests.length===1||alwaysEcho)error('The answer model repeated the question instead of answering.');
  else done('A tuple is an immutable sequence.',false);
  return()=>{};
 },show:t=>shown.push(t)});
 vm.runInContext(fs.readFileSync('src/overlay.js','utf8').replace('\ninit();','\n'),ctx);
 vm.runInContext(`cfg={llm:{baseUrl:'http://localhost:11434/v1',model:'frob/qwen3.5-instruct:4b'},screen:{model:'vision'},behavior:{mode:'interview'}}; setStatus=()=>{}; setMeta=()=>{}; refreshStrip=()=>{}; renderAnswer=show; startAnswer('What is a tuple?');`,ctx);
 if(supersede)vm.runInContext(`startAnswer('New question')`,ctx);
 while(timers.length)await timers.shift()();
 return{requests,shown,answering:vm.runInContext('state.answering',ctx)};
}
(async()=>{
 const recovered=await scenario();assert.equal(recovered.requests.length,2);assert.match(recovered.requests[1][0].content,/previous response copied/);assert.equal(recovered.shown.at(-1),'A tuple is an immutable sequence.');assert.equal(recovered.answering,false);
 const bounded=await scenario(true);assert.equal(bounded.requests.length,2);assert.equal(bounded.answering,false);assert.match(bounded.shown.at(-1),/Could not answer/);
 const stale=await scenario(false,true);assert.equal(stale.requests.length,2);assert.equal(stale.requests[1][0].content,'Answer directly.');
 console.log('PASS echo retries use a clearer prompt, are bounded, preserve selected model, and cannot override newer questions');
})().catch(e=>{console.error(e);process.exitCode=1;});

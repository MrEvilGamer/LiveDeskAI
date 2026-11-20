const vm=require('vm'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
async function scenario(supersede=false, alwaysFail=false, timeout=false) {
  const timers=[],shown=[],meta=[];
  let requests=0;
  const element={classList:{add(){},remove(){}},textContent:''};
  const ctx=vm.createContext({window:{liveDesk:{}},location:{search:''},document:{querySelector:()=>element},performance,Date,console,setTimeout:fn=>timers.push(fn),clearTimeout(){},buildMessages:()=>[],askLLM:(_cfg,_messages,token,done,error)=>{
    requests++;
    token('Partial answer');
    if(requests===1||alwaysFail) error(timeout?'MODEL_TIMEOUT: The answer model timed out.':'AI connection closed before the answer finished'); else done('Recovered answer');
    return ()=>{};
  },show:t=>shown.push(t),meta:t=>meta.push(t)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/overlay.js'),'utf8').replace('\ninit();','\n'),ctx);
  vm.runInContext(`cfg={llm:{baseUrl:'http://localhost:11434/v1',model:'mock'},screen:{model:'vision'},behavior:{mode:'study'}}; setStatus=()=>{}; setMeta=meta; refreshStrip=()=>{}; renderAnswer=show; startAnswer('first question');`,ctx);
  if(supersede)vm.runInContext(`startAnswer('new question');`,ctx);
  while(timers.length)await timers.shift()();
  return {requests,shown,meta,answering:vm.runInContext('state.answering',ctx),offline:vm.runInContext('backends.llm',ctx)};
}
(async()=>{
  const timeout=await scenario(false,true,true);assert.equal(timeout.requests,1);assert.ok(timeout.meta.some(x=>/Model timeout/.test(x)));console.log('PASS model deadlines are explicit and do not trigger repeated long retries');
  const recovery=await scenario();assert.equal(recovery.requests,2);assert.equal(recovery.shown.at(-1),'Recovered answer');assert.equal(recovery.answering,false);console.log('PASS interrupted answer automatically recovers');
  const latest=await scenario(true);assert.equal(latest.requests,2);console.log('PASS stale retries cannot replace a newer question');
  const exhausted=await scenario(false,true);assert.equal(exhausted.requests,3);assert.equal(exhausted.shown.at(-1),'Partial answer');assert.equal(exhausted.answering,false);assert.notEqual(exhausted.offline,false);console.log('PASS recovery is bounded and preserves partial output without a false offline label');
})().catch(e=>{console.error(e);process.exitCode=1;});

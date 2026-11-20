const fs=require('fs'),vm=require('vm');
const ctx=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync('src/renderer/llm.js','utf8'),ctx);
const cfg={llm:{baseUrl:'http://localhost:11434/v1',model:'qwen3:4b-instruct-2507-q4_K_M'},behavior:{mode:'interview',verbosity:'medium',context:'I am a junior Python developer. I built a personal Flask task tracker using SQLite. I have no professional work experience.'}};
const questions=['What is the difference between a Python list and a tuple?','Tell me about a production outage you fixed at your last employer.','What is the time complexity of binary search, and when does it apply?'];
(async()=>{
 for(const q of questions){
  const res=await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cfg.llm.model,stream:false,think:false,messages:ctx.buildMessages(cfg,[],q),options:{temperature:0,num_predict:450,num_ctx:8192}}),signal:AbortSignal.timeout(60000)});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const result=await res.json();console.log(JSON.stringify({question:q,answer:result.message?.content,reason:result.done_reason}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});

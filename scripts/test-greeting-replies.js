const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const wait=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
for(const [question,answer,shouldFail] of [
 ['hello','Hello!',false],['HI','hi',false],['Good morning!','Good morning.',false],['Thank you','Thank you!',false],
 ['What is a tuple?','What is a tuple?',true],['What is a tuple?','An immutable sequence.',false]
]){
 let callback,failed='',finished='',shown='';
 const api={onLlmEvent:cb=>{callback=cb;return()=>{};},llmAbort(){},llmChat:async()=>{
 callback({id:1,type:'delta',text:answer});callback({id:1,type:'done'});return{id:1};
 }};
 const ctx=vm.createContext({window:{liveDesk:api},setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync('src/renderer/llm.js','utf8'),ctx);
 ctx.cfg={llm:{baseUrl:'http://localhost:11434/v1',model:'mock'},behavior:{mode:'interview',verbosity:'short'}};
 ctx.question=question;ctx.show=t=>shown=t;ctx.finish=t=>finished=t;ctx.error=t=>failed=t;
 vm.runInContext('askLLM(cfg,buildMessages(cfg,[],question),show,finish,error)',ctx);await wait();
 assert.equal(Boolean(failed),shouldFail,question);
 if(!shouldFail){assert.equal(finished,answer);assert.equal(shown,answer);}
 console.log('PASS '+question+' -> '+(shouldFail?'copied question rejected':answer));
}
})().catch(e=>{console.error(e);process.exitCode=1;});

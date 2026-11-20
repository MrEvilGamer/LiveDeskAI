const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');let send,error;
const api={onLlmEvent:cb=>{send=cb;return()=>{};},llmChat:async()=>({id:17}),llmAbort:()=>{}};const ctx=vm.createContext({window:{liveDesk:api}});vm.runInContext(fs.readFileSync('src/renderer/llm.js','utf8'),ctx);
ctx.askLLM({llm:{baseUrl:'http://localhost:11434/v1',model:'mock'}},[{role:'user',content:'Question'}],()=>{},()=>{},m=>error=m);
setTimeout(()=>{send({id:17,type:'error',category:'MODEL_TIMEOUT',message:'Model deadline reached'});assert.match(error,/^MODEL_TIMEOUT:/);console.log('PASS model timeout category survives the real stream bridge');},0);

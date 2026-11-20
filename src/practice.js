'use strict';

const $=selector=>document.querySelector(selector),api=window.liveDesk;

let cfg=null,abort=null,sequence=0,selected=null;

const names={algorithms:'Algorithms and SQL',distributed:'Distributed systems',git:'Git, CI/CD and Bash',node:'Node.js and JavaScript',rust:'Rust',security:'Authentication and security',testing:'Testing and verification'};

function setBusy(busy){$('#generate').disabled=busy;$('#review').disabled=busy;$('#cancel').disabled=!busy;}

function list(container,items){container.replaceChildren();for(const text of items){const node=document.createElement('li');node.textContent=text;container.appendChild(node);}}

function showCase(){

 sequence++;if(abort)abort();abort=null;setBusy(false);

 selected=CoachCases.find(c=>c.id===$('#case').value);if(!selected)return;

 $('#question').value=selected.question;$('#prior').hidden=!(selected.context||[]).length;$('#prior').open=Boolean((selected.context||[]).length);$('#priorContext').textContent=(selected.context||[]).map(turn=>'Earlier question: '+turn.question+'\nEarlier suggested answer: '+turn.answer).join('\n\n');$('#candidate').value='';$('#reference').textContent=selected.referenceAnswer;$('#score').textContent='Write an answer, then evaluate it.';$('#dimensions').replaceChildren();$('#weaknesses').replaceChildren();$('#latency').textContent='';$('#status').textContent='';$('#reviewStatus').textContent='Optional separate-model opinion. No API credits are needed with a local model.';

 list($('#mistakes'),selected.commonMistakes);$('#sources').replaceChildren();for(const id of selected.sources){const li=document.createElement('li'),a=document.createElement('a');a.textContent=id;a.href=CoachKnowledge.sources[id];a.target='_blank';a.rel='noopener noreferrer';li.appendChild(a);$('#sources').appendChild(li);}

}

function filter(){const old=$('#case').value;$('#case').replaceChildren();for(const c of CoachCases.filter(c=>$('#domain').value==='all'||c.domain===$('#domain').value)){const o=document.createElement('option');o.value=c.id;o.textContent=(c.adversarial?'Challenge · ':'')+c.question.slice(0,105);$('#case').appendChild(o);}if([...$('#case').options].some(o=>o.value===old))$('#case').value=old;showCase();}

function displayEvaluation(review=null){

 if($('#question').value!==selected.question){$('#score').textContent='Not scored - edited question has no curated rubric';$('#status').textContent='You edited the question. Select a curated question for reference-based scoring, or use generation for an unscored practice discussion.';$('#dimensions').replaceChildren();$('#weaknesses').replaceChildren();return null;}

 const current={...selected,question:$('#question').value};const result=AnswerEvaluator.evaluateCase(current,$('#candidate').value,{independentReview:review,style:$('#depth').value==='short'?'short':'extended'});

 $('#score').textContent=(result.seriousFactualError?'Factual error — fail':result.status==='provisional-pass'?'Provisional pass':'Needs review')+' · '+result.score+'/100';

 $('#dimensions').replaceChildren();for(const [key,value]of Object.entries(result.components)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase());dd.textContent=value===null?'Not applicable':value+'/100';$('#dimensions').append(dt,dd);}

 list($('#weaknesses'),[...result.weaknesses,...(review?[review.explanation]:[])]);

 return result;

}

function invalidateFeedback(){
 $('#score').textContent='Answer changed. Evaluate the current answer again.';$('#dimensions').replaceChildren();$('#weaknesses').replaceChildren();$('#reviewStatus').textContent='Previous feedback does not apply to edited answers or questions.';
}
function editDuringRequest(){if(abort)cancel();invalidateFeedback();}
function cancel(){sequence++;if(abort)abort();abort=null;setBusy(false);$('#latency').textContent='Stopped. Partial text has not been graded as a completed answer.';}

function generate(){

 if(!cfg)return;const seq=++sequence;if(abort)abort();setBusy(true);invalidateFeedback();$('#score').textContent='Generating an example�';$('#status').textContent='';$('#candidate').value='';

 const local={...cfg,llm:{...cfg.llm,maxTokens:$('#depth').value==='long'?1200:450},behavior:{...cfg.behavior,mode:'study',verbosity:$('#depth').value,context:$('#useContext').checked?cfg.behavior.context:''}};

 const question=$('#question').value.trim();if(!question){setBusy(false);return;}

 const messages=buildMessages(local,[],question,selected.context||[]),started=performance.now();let first=null;

 abort=askLLM(local,messages,text=>{if(seq===sequence)$('#candidate').value=text;},(text,aborted)=>{

  if(seq!==sequence)return;setBusy(false);$('#candidate').value=text;$('#latency').textContent=(first===null?'No text':('First token '+(first/1000).toFixed(2)+'s'))+' · total '+((performance.now()-started)/1000).toFixed(2)+'s'+(aborted?' · stopped':'');if(!aborted)displayEvaluation();

 },error=>{if(seq!==sequence)return;setBusy(false);$('#status').textContent=error;},()=>{if(seq===sequence){first=performance.now()-started;$('#latency').textContent='First token '+(first/1000).toFixed(2)+'s';}});

}

function localReviewEndpoint(value){try{const url=new URL(value);return url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}}
function review(){

 if($('#question').value!==selected.question){$('#reviewStatus').textContent='Select a curated question before requesting a reference-based review.';return;}

 if(!cfg||!localReviewEndpoint(cfg.llm.baseUrl)){ $('#reviewStatus').textContent='This review control only runs against your local Ollama endpoint.';return;}

 const model=$('#reviewModel').value;if(!model||!$('#candidate').value.trim())return;

 if(model===cfg.llm.model){$('#reviewStatus').textContent='Select a different local model for a separate review.';return;}

 const reviewedAnswer=$('#candidate').value,reviewedQuestion=$('#question').value,reviewedDepth=$('#depth').value;
 const seq=++sequence;if(abort)abort();setBusy(true);$('#reviewStatus').textContent='Running the separate local reviewer…';

 const local={...cfg,llm:{...cfg.llm,model,maxTokens:1200,temperature:0}};

 abort=askLLM(local,AnswerEvaluator.reviewMessages({...selected,question:$('#question').value},$('#candidate').value),()=>{},(text,aborted)=>{if(seq!==sequence)return;setBusy(false);if(aborted)return;if($('#candidate').value!==reviewedAnswer||$('#question').value!==reviewedQuestion||$('#depth').value!==reviewedDepth){$('#reviewStatus').textContent='Answer, question or depth changed during review. Run the reviewer again for the current answer.';return;}try{const parsed=AnswerEvaluator.parseReview(text);displayEvaluation(parsed);$('#reviewStatus').textContent='Reviewed by '+model+'. This is a fallible second-model opinion; consult the linked sources for disputed claims.';}catch(e){$('#reviewStatus').textContent='Reviewer output could not be validated: '+e.message;}},error=>{if(seq!==sequence)return;setBusy(false);$('#reviewStatus').textContent=error;});

}

async function init(){

 for(const [id,label]of Object.entries(names)){const o=document.createElement('option');o.value=id;o.textContent=label;$('#domain').appendChild(o);}

 $('#candidate').addEventListener('input',editDuringRequest);$('#question').addEventListener('input',editDuringRequest);$('#depth').addEventListener('change',editDuringRequest);
 $('#domain').addEventListener('change',filter);$('#case').addEventListener('change',showCase);$('#next').addEventListener('click',()=>{const c=$('#case');c.selectedIndex=(c.selectedIndex+1)%c.options.length;showCase();});$('#evaluate').addEventListener('click',()=>displayEvaluation());$('#generate').addEventListener('click',generate);$('#cancel').addEventListener('click',cancel);$('#review').addEventListener('click',review);filter();

 if(!api){$('#modelLabel').textContent='Offline rubric preview';$('#generate').disabled=true;$('#review').disabled=true;return;}

 cfg=await api.getConfig();$('#modelLabel').textContent=cfg.llm.model+' · '+(/localhost|127\.0\.0\.1/.test(cfg.llm.baseUrl)?'local':'configured provider');

 api.onConfigUpdated(c=>{cfg=c;$('#modelLabel').textContent=c.llm.model;});

 const models=await api.llmModels({baseUrl:cfg.llm.baseUrl,apiKey:cfg.llm.apiKey});for(const name of models.models||[]){const option=document.createElement('option');option.value=name;option.textContent=name;$('#reviewModel').appendChild(option);}if([...$('#reviewModel').options].some(o=>o.value==='qwen3:8b'))$('#reviewModel').value='qwen3:8b';

}

init().catch(e=>{$('#status').textContent=e.message;});


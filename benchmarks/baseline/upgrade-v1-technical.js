(function(root){
'use strict';
const data = typeof module !== 'undefined' && module.exports ? require('./knowledge') : root.CoachKnowledge;
const stop=new Set('the a an is are was were to of in on for and or with how what why when should does do can would explain describe please use this that it its be as by from'.split(' '));
const tokens=text=>(String(text||'').toLowerCase().match(/[a-z0-9_$:+-]+/g)||[]).filter(t=>t.length>1&&!stop.has(t));
const aliases={'algorithms.heap':'priority queue deadlines expiring tasks schedule sorting minimum timer','algorithms.hash-table':'attacker controlled keys collision flooding hash map','algorithms.pagination':'feed duplicate timestamps concurrent inserts cursor','algorithms.sql-join':'customer invoice paid status unmatched left join','algorithms.amortized':'append latency capacity expansion rare pauses','node.retry-policy':'payment post timeout ambiguous completion client retry','distributed.isolation':'remaining seat sell oversell conditional transaction','distributed.rls':'pooled owner service tenant policy','git.pr-target':'npm install untrusted head pull_request_target secrets','testing.scheduler':'stale asynchronous overwrite controlled promise generation'};
const count=new Map();
const index=data.cards.map(card=>{
 const terms=tokens([card.id,card.title,card.question,card.fact,aliases[card.id]||'',...card.criteria.flat()].join(' '));
 const set=new Set(terms);for(const term of set)count.set(term,(count.get(term)||0)+1);
 return{card,terms,set};
});
const domains={rust:/\b(rust|borrow|ownership|lifetime|refcell|send|sync|arc|box<|rc<|&str|trait|tokio)\b/i,node:/\b(node\.?js|javascript|nexttick|microtask|event.loop|promise|libuv|worker.thread|backpressure|foreach|const|let)\b/i,security:/\b(oauth|pkce|jwt|csrf|xss|token|webhook|hmac|authentication|authorization|rbac|cookie)\b/i,distributed:/\b(kafka|consumer|microservice|distributed|outbox|saga|tenant|circuit|rate.limit|cache|retry|backoff|recovery|payment|idempotency|deadline|throttling)\b/i,git:/\b(git|rebase|merge|bisect|bash|pipeline|github.actions|pull_request|workflow|fork|errexit)\b/i,testing:/\b(test|testing|oracle|replay|scheduler|deadlock|livelock|regression|flaky|fault.injection|fake.clock)\b/i,algorithms:/\b(sql|query|index|binary.search|hash|heap|complexity|lru|pagination|bfs|dfs|dijkstra|amortized|left.join|append|capacity|cursor)\b/i};
function classify(question, history=[]){
 const followUp=/\b(that|this|previous|same|it|why that|what about)\b/i.test(question||'') && tokens(question).length<12;
 const previous=followUp&&history.length?history.at(-1).question:'';
 const text=(question||'')+' '+previous;
 const matches=Object.entries(domains).filter(([,re])=>re.test(text)).map(([name])=>name);
 const type=/design|architect|propose|how would you (?:build|structure)|scale (?:a|the) service/i.test(question)?'architecture':/test|verify|oracle|replay|race|deadlock/i.test(question)?'test-design':/bug|issue|debug|review|wrong|fix/i.test(question)?'debugging':/oauth|pkce|jwt|csrf|xss|webhook|hmac/i.test(question)?'security':'factual';
 return {technical:matches.length>0,domains:matches,type,language:/\brust\b|&str|Arc<|Rc<|RefCell</i.test(text)?'Rust':/javascript|node|nexttick|const|promise|foreach/i.test(text)?'JavaScript/Node.js':/sql|query|postgres/i.test(text)?'SQL':'unspecified',followUp,query:text};
}
function retrieve(question, history=[], limit=3){
 const classification=classify(question,history);
 const query=new Set(tokens(classification.query));
 return index.map(({card,terms,set})=>{
  let score=0;for(const term of query)if(set.has(term))score+=Math.log(1+data.cards.length/(1+(count.get(term)||0)))*(terms.filter(t=>t===term).length>1?1.35:1);
  if(classification.domains.includes(card.domain))score*=1.25;
  const title=card.title.replace(/[- ]/g,'');if(classification.query.toLowerCase().replace(/[- ]/g,'').includes(title))score+=4;
  return{...card,relevance:score};
 }).filter(c=>c.relevance>=(classification.technical?3:7)).sort((a,b)=>b.relevance-a.relevance||a.id.localeCompare(b.id)).slice(0,limit);
}
function prepare(question,{history=[],depth='short',referenceLimit=3}={}){
 const classification=classify(question,history);const cards=retrieve(question,history,referenceLimit);
 if(!classification.technical&&cards.length){classification.technical=true;classification.domains=[cards[0].domain];}
 if(!classification.technical)return{...classification,cards:[],guidance:''};
 const references=cards.map(card=>'['+card.id+'] '+card.fact+' Source IDs: '+card.sources.join(', ')).join('\n');
 const shape=classification.type==='architecture'?'Cover the problem, proposed architecture, implementation, trade-offs, failure handling, and verification. Use one concrete conditional design; do not invent a past project.':classification.type==='test-design'?'For each proposed test name the controlled input/fault/schedule, how it runs, the independent oracle, and how failure is detected.':classification.type==='debugging'?'Identify the exact affected expression or API, the concrete failure, the correction, and a minimal test or boundary case.':'Answer directly; distinguish the concepts and the condition where each applies.';
 const length=depth==='long'?'For an extended answer, explain the mechanism and exact API, relevant edge cases or failure modes, a practical trade-off, and one small example or verification step where useful. Give a complete explanation rather than a one-sentence headline; avoid unrelated detail.':depth==='medium'?'Aim for 4-6 concise spoken sentences, expanding only for necessary code or proof.':'Aim for 2-4 concise spoken sentences. Do not omit a critical qualification just to shorten the answer.';
 return{...classification,cards,guidance:['Technical preparation and permitted-assistance guidance. No hidden chain-of-thought is requested. Provide conclusions, concise justifications, constraints and checks.',shape,length,'A factual technical explanation does not require personal work experience. Answer it from the technical references rather than refusing because a project profile is absent. Use exact language/API terminology. State runtime/version assumptions for ordering, rejection, workflow and database behavior. Distinguish documented facts, proposed designs, and the user\'s verified project facts. If a premise is false, correct it. If an essential constraint is missing, ask one focused clarification. Do not assert that a generated answer was executed or independently verified.',references?'Retrieved documentation-backed notes (topic guidance, not evidence about the user):\n'+references:'No matching local reference found. State uncertainty about niche facts; do not fabricate a citation.'].join('\n')};
}
function correction(question, findings, cards){
 return findings.map(f=>'Correction: '+f.correction).filter((t,i,a)=>a.indexOf(t)===i).join('\n');
}
const api={classify,retrieve,prepare,correction,sourceUrl:id=>data.sources[id],cards:data.cards};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TechnicalCoach=api;
})(typeof globalThis!=='undefined'?globalThis:this);

const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const coach=require('../src/coach/technical'),evaluator=require('../src/coach/evaluator'),data=require('../src/coach/knowledge');
const bank=require('../benchmarks/technical.json').cases;
assert.equal(bank.length,210);assert.equal(new Set(bank.map(c=>c.question)).size,210);assert.equal(new Set(bank.map(c=>c.domain)).size,7);assert.ok(bank.filter(c=>c.adversarial).length>=20);assert.ok(bank.every(c=>c.sources.length&&c.referenceAnswer&&c.commonMistakes.length&&c.criteria.length&&c.verification.sourceEvidenceLocated));
console.log('PASS 210 distinct sourced cases, seven domains, adversarial and follow-up cases');
assert.equal(coach.prepare('hello').technical,false);
assert.ok(coach.prepare('Explain Arc versus Rc in Rust').cards.some(c=>c.id==='rust.rc-arc'));
assert.ok(coach.prepare('How does Node.js backpressure work?').cards.some(c=>c.id==='node.backpressure'));
assert.ok(coach.prepare('And why is that unsafe?',{history:[{question:'Can Arc<RefCell<T>> be shared between threads?',answer:'No, use a synchronization primitive.'}]}).cards.some(c=>c.domain==='rust'));
const architecture=coach.prepare('Design a multi-tenant Kafka processing service',{depth:'long'});assert.equal(architecture.type,'architecture');assert.match(architecture.guidance,/failure handling/);assert.match(architecture.guidance,/proposed architecture/);
console.log('PASS greeting bypass, technical routing, retrieval, follow-up resolution, architecture shape');
const arc=bank.find(c=>c.cardId==='rust.rc-arc'&&c.type==='factual');
const bad=evaluator.evaluateCase(arc,'Rc uses non-atomic reference counting. Arc uses atomic reference counts and makes every inner type thread-safe. Send and Sync provide synchronization.');assert.equal(bad.passed,false);assert.equal(bad.seriousFactualError,true);assert.ok(bad.correctedExplanation.includes('Send'));
assert.equal(evaluator.criticalErrors('It is false that Arc makes every inner type thread-safe. Arc only synchronizes its reference count.').length,0);
assert.equal(evaluator.criticalErrors('Promise.all does not automatically cancel the other requests.').length,0);
assert.ok(evaluator.criticalErrors('Promise.all automatically cancels every remaining request.').length>0);
assert.ok(evaluator.criticalErrors('Arc uses atomic reference counting and makes every inner type thread-safe.').length>0);
console.log('PASS serious-error hard fail, concrete correction, and negated-claim false-positive checks');
assert.throws(()=>evaluator.parseReview('{"seriousFactualError":"false"}'));
assert.throws(()=>evaluator.parseReview(JSON.stringify({seriousFactualError:false,components:{technicalCorrectness:101},explanation:'x',correctedExplanation:'x',evidence:[]})));
const scores=Object.fromEntries(Object.keys(data.weights).map(k=>[k,100]));const reviewed=evaluator.parseReview(JSON.stringify({seriousFactualError:true,components:scores,explanation:'The source contradicts the claim.',correctedExplanation:arc.referenceAnswer,evidence:['Arc does not synchronize arbitrary T.']}));assert.equal(evaluator.evaluateCase(arc,arc.referenceAnswer,{independentReview:reviewed}).passed,false);
console.log('PASS reviewer schema validation and independent-review factual veto');
const ctx=vm.createContext({window:{},TechnicalCoach:coach});vm.runInContext(fs.readFileSync('src/renderer/llm.js','utf8'),ctx);
for(const baseUrl of ['http://localhost:11434/v1','http://localhost:1234/v1']){
 const cfg={llm:{baseUrl},behavior:{mode:'interview',verbosity:'long',context:'Generic user fact. '.repeat(10000)+'END_PROJECT_FACT: Orion uses Rust.'}};
 const messages=ctx.buildMessages(cfg,[], 'Explain Rust ownership and borrowing. '+ 'extra context '.repeat(2000));const length=messages.reduce((n,m)=>n+m.content.length,0);assert.ok(length<(/11434/.test(baseUrl)?16500:5700),'oversized prompt '+length);assert.match(messages[0].content,/Retrieved documentation-backed/);assert.match(messages[0].content,/END_PROJECT_FACT/);
}
console.log('PASS actual upgraded prompt budget includes reference notes and bounded user profile');
const all=coach.prepare('How should a service boundary be chosen?');assert.equal(all.technical,true);
assert.equal(Object.values(data.weights).reduce((a,b)=>a+b),100);

const sanitized=evaluator.parseReview(JSON.stringify({seriousFactualError:false,components:{...scores,unexpected:100},explanation:'Checked',correctedExplanation:'',evidence:[]}));assert.equal('unexpected' in sanitized.components,false);

assert.equal(evaluator.criticalErrors('The assumption that \"sleeping for a long time is the only way to verify retry deadlines\" is invalid because a fake clock can control time.').length,0);

const schedule=coach.prepare('Which always runs first: setTimeout(fn,0) or setImmediate(fn)? No Node version or scheduling context is supplied.');assert.equal(schedule.technical,true);
const technicalMessages=ctx.buildMessages({llm:{baseUrl:'http://localhost:11434/v1'},behavior:{mode:'interview',verbosity:'long'}},[],'Explain Rust ownership');assert.match(technicalMessages.at(-1).content,/ONLY the direct answer/);assert.doesNotMatch(technicalMessages.at(-1).content,/words I should say/);

assert.ok(evaluator.criticalErrors('The database update and message publication occur within a single, atomic transaction.').some(x=>x.cardId==='distributed.outbox'));assert.equal(evaluator.criticalErrors('The database update and message publication do not occur within a single atomic transaction.').length,0);

const timerQuestion='Which always runs first, setTimeout(fn,0) or setImmediate(fn)? No scheduling context is supplied.';assert.ok(evaluator.criticalErrors('setImmediate(fn) always runs first.',undefined,timerQuestion).length);assert.equal(evaluator.criticalErrors('setImmediate(fn) always runs first.',undefined,'Inside an I/O callback, does setImmediate(fn) or setTimeout(fn,0) run first?').length,0);assert.equal(evaluator.criticalErrors('Inside an I/O callback, setImmediate(fn) always runs first.',undefined,timerQuestion).length,0);

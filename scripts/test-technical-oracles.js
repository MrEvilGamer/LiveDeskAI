const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {spawnSync}=require('child_process');
const results=[];const versions={node:process.version};
const record=(name,fn)=>{try{fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL '+name+' '+e.message);}};
const node=(code,args=[])=>{const r=spawnSync(process.execPath,[...args,'-e',code],{encoding:'utf8',timeout:3000,windowsHide:true});if(r.status!==0)throw new Error(r.stderr||r.error?.message);return r.stdout.trim();};
record('CommonJS nextTick and Promise order on installed Node',()=>assert.equal(node(`console.log('A');process.nextTick(()=>console.log('tick'));Promise.resolve().then(()=>console.log('promise'));console.log('C')`),'A\nC\ntick\npromise'));
record('ESM top-level Promise and nextTick order on installed Node',()=>assert.equal(node(`console.log('A');process.nextTick(()=>console.log('tick'));Promise.resolve().then(()=>console.log('promise'));console.log('C')`,['--input-type=module']),'A\nC\npromise\ntick'));
record('Const reassignment throws but object mutation is permitted',()=>{assert.throws(()=>vm.runInNewContext('const total=0; total+=1;',{}, {timeout:100}),/constant/i);assert.equal(vm.runInNewContext('const item={n:0}; item.n++; item.n',{}, {timeout:100}),1);});
record('Promise.all does not cancel another already-started operation',()=>assert.equal(node(`let finish;const other=new Promise(r=>finish=r);Promise.all([Promise.reject(Error('fail')),other]).catch(()=>{finish('committed');other.then(console.log)});`),'committed'));
record('Writable false accepts the chunk and emits drain',()=>assert.equal(node(`const{Writable}=require('stream');let got='';const w=new Writable({highWaterMark:1,write(c,e,cb){got+=c;setImmediate(cb)}});console.log(w.write('x'));w.once('drain',()=>console.log(got));`),'false\nx'));
const crypto=require('crypto');
record('RFC 7636 S256 published PKCE vector',()=>assert.equal(crypto.createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64url'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
record('Webhook HMAC binds exact raw bytes and detects tampering',()=>{const secret='synthetic-test-secret',raw=Buffer.from('{ \"id\": 1 }');const mac=body=>crypto.createHmac('sha256',secret).update(body).digest();const expected=mac(raw);assert.ok(crypto.timingSafeEqual(expected,mac(raw)));assert.ok(!crypto.timingSafeEqual(expected,mac(Buffer.from(JSON.stringify(JSON.parse(raw))))));});
record('A decodable signed-token payload can be tampered without signature validity',()=>{const payload=Buffer.from(JSON.stringify({role:'reader'})).toString('base64url');const signature=crypto.createHmac('sha256','synthetic-test-secret').update(payload).digest('hex');const modified=Buffer.from(JSON.stringify({role:'admin'})).toString('base64url');assert.equal(JSON.parse(Buffer.from(modified,'base64url')).role,'admin');assert.notEqual(signature,crypto.createHmac('sha256','synthetic-test-secret').update(modified).digest('hex'));});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'livedesk-coach-oracles-'));
const rustVersion=spawnSync('rustc',['--version'],{encoding:'utf8',windowsHide:true});versions.rust=rustVersion.stdout.trim();
const rustCases=[
 ['move invalidates String binding','fn f(){let a=String::from("x");let b=a;println!("{} {}",a,b);}',false],
 ['returning local reference is rejected',"fn f<'a>()-> &'a str {let s=String::from(\"x\"); &s}",false],
 ['Rc is not Send','use std::rc::Rc; fn f(){let n=Rc::new(1);std::thread::spawn(move||{println!("{}",n);});}',false],
 ['Arc RefCell is not thread-safe shared state','use std::{cell::RefCell,sync::Arc}; fn f(){let n=Arc::new(RefCell::new(1));std::thread::spawn(move||{n.borrow_mut();});}',false],
 ['Box recursive structure has finite size','enum List{Cons(i32,Box<List>),Nil}',true],
 ['Result question mark propagates parse error','fn parse(s:&str)->Result<i32,std::num::ParseIntError>{let n=s.parse()?;Ok(n)}',true],
 ['Option question mark needs explicit conversion in Result return','fn f()->Result<i32,String>{let n=Some(1)?;Ok(n)}',false],
 ['owned String return does not dangle','fn f()->String{String::from("x")}',true]
];
if(rustVersion.status===0){for(const [name,code,success]of rustCases)record('Rust '+name,()=>{const file=path.join(temp,'oracle.rs');fs.writeFileSync(file,code);const r=spawnSync('rustc',['--edition=2021','--crate-type=lib','--out-dir',temp,file],{encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(r.status===0,success,r.stderr);});}else results.push({name:'Rust compiler unavailable',passed:false,error:rustVersion.error?.message});
if(rustVersion.status===0)record('Rust RefCell conflicting reentrant borrow panics safely',()=>{
 const file=path.join(temp,'refcell_runtime.rs'),binary=path.join(temp,'refcell_runtime.exe');
 fs.writeFileSync(file,'use std::cell::RefCell;fn main(){let cell=RefCell::new(1);let _guard=cell.borrow_mut();let _conflict=cell.borrow_mut();}');
 const built=spawnSync('rustc',['--edition=2021',file,'-o',binary],{encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(built.status,0,built.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8',timeout:3000,windowsHide:true});assert.notEqual(run.status,0);assert.match(run.stderr,/already borrowed|BorrowMutError/i);
});
const bash='C:/Program Files/Git/bin/bash.exe';
if(fs.existsSync(bash)){
 const run=code=>{const r=spawnSync(bash,['--noprofile','--norc','-c',code],{encoding:'utf8',timeout:3000,windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 record('Bash :- substitutes without assignment',()=>assert.equal(run('unset name; printf "%s:" "${name:-guest}"; printf "%s" "${name-unset}"'),'guest:unset'));
 record('Bash := assigns the default',()=>assert.equal(run('unset name; : "${name:=guest}"; printf "%s" "$name"'),'guest'));
 record('Bash pipefail reports producer failure',()=>assert.equal(run('set +e; false | true; printf "%s:" "$?"; set -o pipefail; false | true; printf "%s" "$?"'),'0:1'));
}else results.push({name:'Bash unavailable',passed:false});
// SQL behavior is verified with SQLite, not presented as a PostgreSQL/RLS integration test.
record('SQL NULL and outer-join oracles on SQLite',()=>{
 const code=`import sqlite3,json\nc=sqlite3.connect(':memory:')\nc.executescript('CREATE TABLE a(id); INSERT INTO a VALUES(1),(2); CREATE TABLE b(id,status); INSERT INTO b VALUES(1,\"unpaid\"),(NULL,\"paid\");')\nprint(json.dumps([c.execute('SELECT a.id FROM a LEFT JOIN b ON a.id=b.id AND b.status=\"paid\"').fetchall(),c.execute('SELECT id FROM a WHERE id NOT IN (SELECT id FROM b)').fetchall(),c.execute('SELECT id FROM a WHERE NOT EXISTS(SELECT 1 FROM b WHERE b.id=a.id)').fetchall(),c.execute('SELECT a.id FROM a LEFT JOIN b ON a.id=b.id WHERE b.status=\"paid\"').fetchall()]))`;
 const r=spawnSync('python',['-c',code],{encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),[[[1],[2]],[],[[2]],[]]);
});
record('Transactional outbox rollback and duplicate-relay simulation on SQLite',()=>{
 const code=`import sqlite3\nc=sqlite3.connect(':memory:')\nc.executescript('CREATE TABLE business(id PRIMARY KEY); CREATE TABLE outbox(id PRIMARY KEY); CREATE TABLE processed(id PRIMARY KEY); CREATE TABLE effects(id);')\nc.execute('BEGIN')\nc.execute('INSERT INTO business VALUES(1)')\nc.execute('INSERT INTO outbox VALUES(1)')\nc.rollback()\nassert c.execute('SELECT count(*) FROM business').fetchone()[0]==0\nassert c.execute('SELECT count(*) FROM outbox').fetchone()[0]==0\nwith c:\n c.execute('INSERT INTO business VALUES(1)')\n c.execute('INSERT INTO outbox VALUES(1)')\n# A crash before recording a broker acknowledgement can cause the relay to send twice.\nfor event in [1,1]:\n with c:\n  claimed=c.execute('INSERT OR IGNORE INTO processed VALUES(?)',(event,)).rowcount\n  if claimed:c.execute('INSERT INTO effects VALUES(?)',(event,))\nassert c.execute('SELECT count(*) FROM effects').fetchone()[0]==1\nprint('atomic database commit; duplicate delivery; single consumer effect')`;
 const r=spawnSync('python',['-c',code],{encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/duplicate delivery/);
});
fs.mkdirSync('benchmarks/results',{recursive:true});fs.writeFileSync('benchmarks/results/executable-oracles.json',JSON.stringify({at:new Date().toISOString(),versions,temporaryDirectory:temp,results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;

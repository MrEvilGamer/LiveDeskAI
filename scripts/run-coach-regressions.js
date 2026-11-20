const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const commands=[['Core regression suite','npm.cmd',['test']],['Technical executable checks',process.execPath,['scripts/test-technical-oracles.js']],['Runtime factual veto',process.execPath,['scripts/test-runtime-quality-gate.js']],['Practice UI','node_modules/.bin/electron.cmd',['scripts/test-practice-ui.js']],['Live pipeline',process.execPath,['scripts/test-live.js']],['Speech service','python',['scripts/test_stt.py']]];
const previous=process.argv.includes('--failed')&&fs.existsSync('benchmarks/results/regressions.json')?JSON.parse(fs.readFileSync('benchmarks/results/regressions.json')).results:[];
const reports=previous.filter(r=>r.passed);
for(const [name,originalProgram,originalArgs]of commands){
 if(previous.some(r=>r.name===name&&r.passed))continue;
 let program=originalProgram,args=originalArgs;
 if(originalProgram==='npm.cmd'){program=process.execPath;args=[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...args];}
 if(originalProgram.endsWith('electron.cmd'))program=require('electron');
 const start=Date.now();const r=spawnSync(program,args,{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:4e6});const item={name,command:[program,...args].join(' '),passed:r.status===0,exitCode:r.status,totalMs:Date.now()-start,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error?.message};reports.push(item);console.log((item.passed?'PASS ':'FAIL ')+name);
}
fs.mkdirSync('benchmarks/results',{recursive:true});fs.writeFileSync('benchmarks/results/regressions.json',JSON.stringify({at:new Date().toISOString(),results:reports},null,2));if(reports.some(r=>!r.passed))process.exitCode=1;

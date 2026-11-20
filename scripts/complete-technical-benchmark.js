const fs=require('fs');const {spawnSync}=require('child_process');
(async()=>{const start=Date.now();while(true){const file='benchmarks/results/baseline.jsonl';const n=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).length:0;if(n>=420)break;if(Date.now()-start>3600000)throw new Error('Baseline did not finish within the coordination timeout');await new Promise(r=>setTimeout(r,2000));}
 for(const script of [['scripts/run-technical-benchmark.js','--phase=upgraded'],['scripts/review-technical-benchmark.js'],['scripts/summarize-technical-benchmark.js']]){const r=spawnSync(process.execPath,script,{stdio:'inherit',windowsHide:true});if(r.status!==0)throw new Error('Benchmark stage failed: '+script[0]);}
})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('fs'),vm=require('vm');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'src/renderer/humanize.js'), 'utf8')+';this.humanize=humanize',c);
const cases=[
 ['Sure! I\'d say **staying calm** matters most.', "I'd say staying calm matters most."],
 ['Use `my_var_name` and snake_case_ok here', 'Use my_var_name and snake_case_ok here'],
 ['Here\'s what you could say: I led the migration.', 'I led the migration.'],
 ['"I led the migration."', 'I led the migration.'],
 ['- first\n- second', 'first\nsecond'],
 ['x = a*b + c', 'x = a*b + c'],
 ['This is *really* good', 'This is really good'],
 ['**half', 'half'],
];
let ok=true;for(const [i,e] of cases){const o=c.humanize(i);const p=o===e;ok&&=p;console.log(p?'PASS':'FAIL',JSON.stringify(i),'->',JSON.stringify(o));}
process.exit(ok?0:1)

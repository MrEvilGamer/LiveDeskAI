const fs=require('fs'),path=require('path');
fs.mkdirSync(path.join(__dirname,'../assets'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'../assets/runtime-root.json'),JSON.stringify({root:path.resolve(__dirname,'..')}));

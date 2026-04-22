require('dotenv').config();
const{Client}=require('ssh2');
function r(c,cmd){return new Promise((ok,no)=>{c.exec(cmd,(e,s)=>{if(e)return no(e);let o='';s.on('data',d=>{o+=d}).stderr.on('data',d=>{o+=d}).on('close',()=>ok(o))})})}
async function main(){
const c=new Client();
await new Promise((ok,no)=>{c.on('ready',ok).on('error',no).connect({host:process.env.SERVER_IP,port:22,username:'root',password:process.env.SERVER_PASSWORD})});
console.log('Connected');
var sqls=[
"ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR;",
"ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR;",
"ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_pd BOOLEAN DEFAULT FALSE;",
];
for(var s of sqls){
  console.log(await r(c,"docker exec skufia-postgres psql -U postgres -d skufia -c \""+s+"\""));
}
console.log('Columns added. Restarting...');
console.log(await r(c,'docker restart skufia-api'));
await new Promise(x=>setTimeout(x,10000));
console.log(await r(c,'docker logs --tail 15 skufia-api 2>&1'));
c.end();
}
main().catch(e=>{console.error(e.message);process.exit(1)});

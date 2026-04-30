const {Client} = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('grep "CACHE_NAME" /opt/skufia/frontend/chat-sw.js | head -1', (e, s) => {
    if(e) { console.error(e); c.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => c.end());
  });
}).connect({host:'147.45.245.133',port:22,username:'root',password:'y38N*dQM.X33k?'});

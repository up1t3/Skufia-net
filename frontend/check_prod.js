const {Client} = require('ssh2');
const fs = require('fs');
const c = new Client();
c.on('ready', () => {
  const cmds = [
    'grep -n "send-chat-btn" /opt/skufia/frontend/index.html',
    'grep -n "sendChatBtn\\|addEventListener.*click.*sendChatMsg\\|window.sendChatMsg" /opt/skufia/frontend/chat_core.js | head -20',
    'docker ps --format "{{.Names}} {{.Status}}" | grep skufia'
  ];
  let idx = 0;
  function runNext() {
    if (idx >= cmds.length) { c.end(); return; }
    const cmd = cmds[idx++];
    console.log('\n>>> ' + cmd);
    c.exec(cmd, (e, s) => {
      if(e) { console.error(e); runNext(); return; }
      s.on('data', d => process.stdout.write(d.toString()));
      s.stderr.on('data', d => process.stderr.write(d.toString()));
      s.on('close', () => runNext());
    });
  }
  runNext();
}).connect({host:'147.45.245.133',port:22,username:'root',password:'y38N*dQM.X33k?'});

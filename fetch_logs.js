const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`docker logs --tail 200 skufia-api-green`, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      conn.end();
    }).on('data', (data) => {
      console.log('STDOUT: ' + data);
    }).stderr.on('data', (data) => {
      console.log('STDERR: ' + data);
    });
  });
}).connect({
  host: '147.45.245.133',
  port: 22,
  username: 'root',
  password: 'y38N*dQM.X33k?'
});

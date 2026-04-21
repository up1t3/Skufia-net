'use strict';
require('dotenv').config();
const { Client } = require('ssh2');
const fs = require('fs');

const CONFIG = {
  host: process.env.SERVER_IP,
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD
};

const conn = new Client();
conn.on('ready', () => {
  console.log('✅ Client :: ready');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('✅ SFTP :: ready');
    
    sftp.fastPut('docker-compose.production.yml', '/opt/skufia/docker-compose.production.yml', (err) => {
      if (err) throw err;
      console.log('✅ Окончательно загружен docker-compose.production.yml на сервер!');
      
      // Перезапускаем skufia-web с новым файлом:
      conn.exec('cd /opt/skufia && docker compose -f docker-compose.production.yml down && docker compose -f docker-compose.production.yml up -d', (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
          console.log('✅ Контейнеры перезапущены с маппингом 443 порта и SSL.');
          conn.end();
        }).on('data', (data) => process.stdout.write(data))
          .stderr.on('data', (data) => process.stderr.write(data));
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ Connection :: error ::', err);
}).connect(CONFIG);

'use strict';
require('dotenv').config();
const { Client } = require('ssh2');

const CONFIG = {
  ip: process.env.SERVER_IP,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  port: 22,
  domain: 'skuf-net.ru',
  altDomain: 'xn--e1afmapc3af.xn--p1ai',
  email: 'up1t3rV@yandex.ru'
};

function connectSSH() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject).connect({
      host: CONFIG.ip,
      port: CONFIG.port,
      username: CONFIG.username,
      password: CONFIG.password
    });
  });
}

function runSSH(conn, cmds) {
  if (Array.isArray(cmds)) cmds = cmds.join(' && ');
  return new Promise((resolve, reject) => {
    console.log(`\n▶ Выполнение: ${cmds}`);
    conn.exec(cmds, (err, stream) => {
      if (err) return reject(err);
      let output = '';
      stream.on('close', (code) => {
        if (code !== 0) return reject(new Error(`Код ошибки: ${code}. Вывод: ${output}`));
        resolve(output);
      }).on('data', d => { output += d; process.stdout.write(d); })
        .stderr.on('data', d => { output += d; process.stderr.write(d); });
    });
  });
}

async function main() {
  console.log(`🚀 Начинается настройка SSL для ${CONFIG.domain} на сервере ${CONFIG.ip}`);
  
  let conn;
  try {
    conn = await connectSSH();
    console.log('✅ Подключение по SSH установлено');

    console.log('\n[Шаг 1] Установка Certbot...');
    await runSSH(conn, 'apt-get update && apt-get install -y certbot');

    console.log('\n[Шаг 2] Остановка контейнера skufia-web...');
    await runSSH(conn, 'docker stop skufia-web || true');

    console.log('\n[Шаг 3] Запуск сбора сертификатов Let\'s Encrypt...');
    await runSSH(conn, `certbot certonly --standalone --non-interactive --agree-tos -m ${CONFIG.email} -d ${CONFIG.domain}`);
    
    console.log('\n[Шаг 4] Перезапуск контейнеров...');
    await runSSH(conn, 'cd /opt/skufia && docker compose -f docker-compose.production.yml up -d');

    console.log(`\n✅ Успешно настроен HTTPS! Сертификаты лежат в /etc/letsencrypt/live/${CONFIG.domain} на сервере.`);
  } catch (err) {
    console.error(`\n❌ Ошибка настройки SSL: ${err.message}`);
    if (conn) {
       console.log('Восстанавливаем работу skufia-web...');
       try { await runSSH(conn, 'cd /opt/skufia && docker compose -f docker-compose.production.yml up -d'); } catch(e){}
    }
  } finally {
    if (conn) conn.end();
  }
}

main();

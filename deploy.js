#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════╗
 * ║   СКУФИЯ — Smart Local Deploy Script    ║
 * ║   Запуск: npm run deploy                ║
 * ╚══════════════════════════════════════════╝
 *
 * Шаги:
 *  1. Загрузка конфига из .env
 *  2. Locальный прогон тестов pytest
 *  3. Сборка Docker-образов (backend + frontend)
 *  4. Push образов в GHCR (ghcr.io/up1t3/...)
 *  5. SSH на сервер → pull + up -d
 *  6. Проверка доступности сайта
 */

'use strict';

require('dotenv').config();
const { execSync, spawn } = require('child_process');
const { Client } = require('ssh2');
const path = require('path');

// ─── Конфигурация ───────────────────────────────────────────────
const CONFIG = {
  ghcr: {
    user: process.env.GHCR_USER || 'up1t3',
    token: process.env.GHCR_TOKEN,
  },
  server: {
    ip: process.env.SERVER_IP || '147.45.245.133',
    user: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD,
    port: 22,
  },
  images: {
    backend: '',  // заполняется ниже
    frontend: '', // заполняется ниже
  },
  skipTests: process.argv.includes('--skip-tests'),
};

CONFIG.images.backend  = `ghcr.io/${CONFIG.ghcr.user}/skufia-backend:latest`;
CONFIG.images.frontend = `ghcr.io/${CONFIG.ghcr.user}/skufia-frontend:latest`;

// ─── Цветной вывод ──────────────────────────────────────────────
const cyan  = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red   = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow= (s) => `\x1b[33m${s}\x1b[0m`;
const bold  = (s) => `\x1b[1m${s}\x1b[0m`;

function log(emoji, msg) {
  const time = new Date().toLocaleTimeString('ru-RU');
  console.log(`${cyan(`[${time}]`)} ${emoji}  ${msg}`);
}

function step(title) {
  console.log(`\n${bold(cyan('▶ ' + title))}`);
}

function success(msg) { console.log(green(`  ✅ ${msg}`)); }
function warn(msg)    { console.log(yellow(`  ⚠️  ${msg}`)); }
function fail(msg)    { console.log(red(`  ❌ ${msg}`)); }

// ─── Вспомогательные функции ────────────────────────────────────
function run(cmd, opts = {}) {
  log('⚙️', `Выполняю: ${yellow(cmd)}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function runSSH(conn, commands) {
  return new Promise((resolve, reject) => {
    const cmd = Array.isArray(commands) ? commands.join(' && ') : commands;
    log('🖥️', `SSH: ${yellow(cmd)}`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => {
          if (code !== 0) return reject(new Error(`SSH команда завершилась с кодом ${code}\n${errOut}`));
          resolve(out);
        })
        .on('data', (d) => { process.stdout.write(d); out += d; })
        .stderr.on('data', (d) => { process.stderr.write(d); errOut += d; });
    });
  });
}

function connectSSH(cfg) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn))
        .on('error', reject)
        .connect({
          host: cfg.ip,
          port: cfg.port,
          username: cfg.user,
          password: cfg.password,
          readyTimeout: 30000,
        });
  });
}

// ─── 1. Проверка конфигурации ───────────────────────────────────
function checkConfig() {
  step('Проверка конфигурации');
  const missing = [];
  if (!CONFIG.ghcr.token)       missing.push('GHCR_TOKEN');
  if (!CONFIG.server.password)  missing.push('SERVER_PASSWORD');
  if (missing.length) {
    fail(`В файле .env отсутствуют переменные: ${missing.join(', ')}`);
    process.exit(1);
  }
  success('Конфигурация загружена');
  log('🎯', `Бэкенд-образ: ${CONFIG.images.backend}`);
  log('🎯', `Фронтенд-образ: ${CONFIG.images.frontend}`);
  log('🎯', `Сервер: ${CONFIG.server.ip}`);
}

// ─── 2. Локальный прогон тестов ─────────────────────────────────
function runTests() {
  if (CONFIG.skipTests) {
    warn('Тесты пропущены (флаг --skip-tests)');
    return;
  }
  step('Прогон тестов (pytest)');
  try {
    run('python -m pytest backend/tests/ -v --tb=short');
    success('Все тесты прошли!');
  } catch (e) {
    fail('Тесты не прошли — деплой ОТМЕНЁН');
    process.exit(1);
  }
}

// ─── 3. Сборка Docker-образов ───────────────────────────────────
function buildImages() {
  step('Сборка Docker-образов (локально)');
  run('docker build -t skufia-backend ./backend');
  run('docker build -t skufia-frontend ./frontend');
  success('Образы собраны');
}

// ─── 4. Push в GHCR ─────────────────────────────────────────────
function pushImages() {
  step('Отправка образов в GitHub Container Registry');

  // Login
  execSync(
    `echo ${CONFIG.ghcr.token} | docker login ghcr.io -u ${CONFIG.ghcr.user} --password-stdin`,
    { stdio: ['pipe', 'inherit', 'inherit'] }
  );
  success('Авторизация в GHCR успешна');

  // Tag
  run(`docker tag skufia-backend ${CONFIG.images.backend}`);
  run(`docker tag skufia-frontend ${CONFIG.images.frontend}`);

  // Push
  run(`docker push ${CONFIG.images.backend}`);
  run(`docker push ${CONFIG.images.frontend}`);
  success('Образы загружены в GHCR');
}

// ─── 5. Деплой на сервер ────────────────────────────────────────
async function deployToServer() {
  step('Деплой на сервер Timeweb');
  log('🔌', `Подключаюсь к ${CONFIG.server.ip}...`);

  const conn = await connectSSH(CONFIG.server);
  success('SSH-соединение установлено');

  const deployDir = '/opt/skufia';
  const composeFile = 'docker-compose.production.yml';

  await runSSH(conn, [
    // Авторизация в GHCR прямо на сервере
    `echo ${CONFIG.ghcr.token} | docker login ghcr.io -u ${CONFIG.ghcr.user} --password-stdin`,
    // Переходим в папку проекта
    `mkdir -p ${deployDir}/frontend`,
    `cd ${deployDir}`,
    // Записываем обновленные файлы на сервер (с локальной копии)
    `echo "${require('fs').readFileSync('docker-compose.production.yml').toString('base64')}" | base64 -d > docker-compose.production.yml`,
    `echo "${require('fs').readFileSync('frontend/upstream.conf').toString('base64')}" | base64 -d > frontend/upstream.conf`,
    // Скачиваем свежие образы
    `docker compose -f ${composeFile} pull`,
    // Перезапускаем сервисы с нулевым даунтаймом
    `docker compose -f ${composeFile} up -d --remove-orphans`,
    // Применяем миграции БД (создаём новые таблицы если их нет)
    `docker exec skufia-api-green python -c "from database import init_db; init_db(); print('DB migration applied')"`,
    // Убираем старые образы
    `docker image prune -f`,
  ]);

  success('Контейнеры обновлены!');

  // Проверяем доступность
  log('🔍', 'Проверяю доступность сайта...');
  await new Promise(r => setTimeout(r, 5000)); // ждём 5 сек старту

  const result = await runSSH(conn, `curl -s -o /dev/null -w "%{http_code}" http://localhost`);
  conn.end();

  const code = result.trim().slice(-3);
  if (code === '200') {
    success(`Сайт доступен! HTTP ${code}`);
  } else {
    warn(`Сайт вернул HTTP ${code} — проверьте логи на сервере`);
  }
}

// ─── Главная функция ────────────────────────────────────────────
async function main() {
  console.log('\n' + bold('╔════════════════════════════════════════╗'));
  console.log(bold('║  🚀 СКУФИЯ Smart Deploy Pipeline  🚀   ║'));
  console.log(bold('╚════════════════════════════════════════╝') + '\n');

  const start = Date.now();

  checkConfig();
  runTests();
  buildImages();
  pushImages();
  await deployToServer();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${bold(green('╔════════════════════════════════════════╗'))}`);
  console.log(bold(green(`║   ✅ Деплой завершён за ${elapsed}с!           ║`)));
  console.log(bold(green('╠════════════════════════════════════════╣')));
  console.log(bold(green('║  🌐 http://skuf-net.ru                 ║')));
  console.log(bold(green('║  🌐 http://xn--e1afmapc3af.xn--p1ai   ║')));
  console.log(bold(green('╚════════════════════════════════════════╝')) + '\n');
}

main().catch((err) => {
  fail(`Критическая ошибка: ${err.message}`);
  process.exit(1);
});

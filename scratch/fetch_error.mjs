import fs from 'fs';
import https from 'https';

const API_KEY = process.env.JULES_API_KEY;
const SESSION_ID = process.env.JULES_SESSION_ID || '17192604980070498672';
const API_URL = `https://jules.google/api/v1/sessions/${SESSION_ID}/full`; // Example internal endpoint

if (!API_KEY) {
    console.error('❌ Ошибка: Не задан JULES_API_KEY в переменных окружения.');
    process.exit(1);
}

console.log(`⏳ Запрос логов для сессии ${SESSION_ID}...`);

const options = {
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    }
};

https.get(API_URL, options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode === 200) {
            fs.writeFileSync('session_log.json', data);
            console.log('✅ Логи успешно сохранены в session_log.json');
        } else {
            console.error(`❌ Ошибка API: ${res.statusCode}`);
            console.error(data);
        }
    });
}).on('error', (err) => {
    console.error('❌ Ошибка сети: ', err.message);
});

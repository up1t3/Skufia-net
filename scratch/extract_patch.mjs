import fs from 'fs';

const LOG_FILE = 'session_log.json';
const OUTPUT_FILE = 'extracted_patches.diff';

if (!fs.existsSync(LOG_FILE)) {
    console.error(`❌ Ошибка: Файл ${LOG_FILE} не найден. Сначала выполните fetch_error.mjs`);
    process.exit(1);
}

console.log(`⏳ Извлечение изменений из ${LOG_FILE}...`);

try {
    const rawData = fs.readFileSync(LOG_FILE, 'utf8');
    const logs = JSON.parse(rawData);
    
    let patches = '';
    
    if (logs.activities && Array.isArray(logs.activities)) {
        logs.activities.forEach((activity, index) => {
            if (activity.changesPreview && activity.changesPreview !== 'No changes') {
                patches += `\n--- Изменение шаг ${index} ---\n`;
                patches += activity.changesPreview + '\n';
            }
        });
    }

    if (patches.length > 0) {
        fs.writeFileSync(OUTPUT_FILE, patches);
        console.log(`✅ Найдено изменений. Они сохранены в файл: ${OUTPUT_FILE}`);
    } else {
        console.log('⚠️ В логах не найдено сгенерированных патчей кода.');
    }
} catch (err) {
    console.error('❌ Ошибка при разборе JSON или записи файла:', err.message);
}

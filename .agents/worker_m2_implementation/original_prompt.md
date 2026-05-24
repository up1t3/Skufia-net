## 2026-05-24T11:07:05Z

Вы являетесь Worker суб-агентом. Ваша задача — выполнить Milestone 2: Темы оформления и шрифты (UI/UX) для мессенджера SKUFenger.

### Рабочая директория:
Ваша рабочая директория: `e:\Skufia-net\.agents\worker_m2_implementation`. Пожалуйста, пишите свои файлы координации и отчеты только в эту директорию.

### Входные данные:
Ознакомьтесь с отчетами исследователей:
- `e:\Skufia-net\.agents\explorer_m2_1\analysis_report.md`
- `e:\Skufia-net\.agents\explorer_m2_2\analysis_report.md`
- `e:\Skufia-net\.agents\explorer_m2_3\analysis_report.md`

### Конкретные шаги по реализации:

1. **Добавление переменной `--accent-red` во все темы:**
   В файле `frontend/style.css` добавьте переменную `--accent-red` во все секции тем оформления:
   - Тема по умолчанию / Cyber (в `:root` и `body[data-theme="cyber"]`): `--accent-red: #ff4444;`
   - Telegram Dark (`body[data-theme="telegram"]`): `--accent-red: #ec3b3b;`
   - Neon Glassmorphism (`body[data-theme="neon"]`): `--accent-red: #f43f5e;`
   - Light iOS (`body[data-theme="light-ios"]`): `--accent-red: #FF3B30;`
   - Cyber Gold (`body[data-theme="gold"]`): `--accent-red: #ff4d4d;`

2. **Рефакторинг контекстного меню сообщений (`.msg-context-menu`):**
   В файле `frontend/style.css` замените захардкоженные цвета в стилях контекстного меню:
   - Замените `box-shadow` в `.msg-context-menu` на:
     `box-shadow: var(--panel-shadow), 0 0 0 1px var(--border-metal);`
   - Замените цвет текста пунктов меню `.msg-context-menu div` на `color: var(--text-main);`
   - Замените фон ховера `.msg-context-menu div:hover` на `background: var(--bg-accent);`
   - Замените фон активного состояния `.msg-context-menu div:active` на `background: color-mix(in srgb, var(--accent-cyan) 15%, transparent);`
   - Замените цвет деструктивного действия `.msg-context-menu .delete-ctx` на `color: var(--accent-red);`
   - Замените ховер деструктивного действия `.msg-context-menu .delete-ctx:hover` на `background: color-mix(in srgb, var(--accent-red) 12%, transparent);`

3. **Рефакторинг оверлея и элементов авторизации:**
   - В файле `frontend/style.css` для `#auth-overlay` замените фон `background: rgba(0, 0, 0, 0.85);` на:
     `background: color-mix(in srgb, var(--bg-dark) 85%, transparent);`
     И добавьте `backdrop-filter: var(--backdrop-blur);`
   - В файле `frontend/style.css` для `.cyber-input:focus, .cyber-textarea:focus` замените `box-shadow: 0 0 10px rgba(0, 255, 65, 0.2);` на:
     `box-shadow: 0 0 10px color-mix(in srgb, var(--accent-cyan) 20%, transparent);`
   - В файле `frontend/style-modal.css` для кнопки авторизации `.auth-main-btn`:
     - Замените градиент фона на:
       `background: linear-gradient(90deg, color-mix(in srgb, var(--accent-cyan) 10%, transparent) 0%, color-mix(in srgb, var(--accent-cyan) 30%, transparent) 50%, color-mix(in srgb, var(--accent-cyan) 10%, transparent) 100%) !important;`
     - Замените `box-shadow` на:
       `box-shadow: 0 0 15px color-mix(in srgb, var(--accent-cyan) 40%, transparent), inset 0 0 10px color-mix(in srgb, var(--accent-cyan) 20%, transparent) !important;`
     - Для `:hover` и `:active` замените `box-shadow` на:
       `box-shadow: 0 0 25px color-mix(in srgb, var(--accent-cyan) 80%, transparent), inset 0 0 15px rgba(255, 255, 255, 0.5) !important;`
     - Замените цвет текста кнопки `color: #fff !important;` на `color: var(--text-main) !important;` (чтобы гармонировать со светлой темой), а при ховере/активном состоянии — на `color: var(--bg-dark) !important;`.
   - В файле `frontend/style-modal.css` для кнопки `.save-btn-premium`:
     - Замените `background: linear-gradient(135deg, var(--accent-cyan), #0078ff) !important;` на:
       `background: linear-gradient(135deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan) 70%, #000)) !important;`
     - Замените тени `box-shadow` в обычном и hover состояниях на версии с `color-mix()` на основе акцентного цвета:
       Обычное: `box-shadow: 0 8px 20px color-mix(in srgb, var(--accent-cyan) 30%, transparent) !important;`
       Hover: `box-shadow: 0 12px 30px color-mix(in srgb, var(--accent-cyan) 50%, transparent) !important;`

4. **Вынос стилей согласия ФЗ-152 в CSS и обновление HTML:**
   - В файле `frontend/style-modal.css` (или `style.css`) добавьте CSS-классы:
     ```css
     .pd-consent-block {
         background: color-mix(in srgb, var(--accent-cyan) 5%, transparent);
         border: 1px solid color-mix(in srgb, var(--accent-cyan) 20%, transparent);
         border-radius: 8px;
         padding: 12px;
         margin-bottom: 15px;
     }
     .pd-consent-label {
         display: flex;
         align-items: flex-start;
         gap: 10px;
         cursor: pointer;
         font-size: 12px;
         color: var(--text-dim);
         line-height: 1.5;
     }
     .pd-consent-checkbox {
         width: 16px;
         height: 16px;
         flex-shrink: 0;
         margin-top: 2px;
         cursor: pointer;
         accent-color: var(--accent-cyan);
     }
     ```
   - В файлах `frontend/index.html` and `frontend/messenger.html` замените инлайновые стили контейнера согласия ФЗ-152, его лейбла и чекбокса на созданные классы `.pd-consent-block`, `.pd-consent-label` и `.pd-consent-checkbox`. Убедитесь, что логика `onchange` и `id` чекбокса полностью сохранены для прохождения E2E тестов.

5. **Стилизация выпадающих списков (`select`):**
   Добавьте в `frontend/style.css` стили для выпадающих списков (`select`) и класса `.input-text`, чтобы они гармонично вписывались в оформление тем:
   ```css
   select, .input-text {
       background-color: var(--bg-accent);
       border: 1px solid var(--border-metal);
       color: var(--text-main);
       padding: 8px 12px;
       font-family: var(--font-main), inherit;
       border-radius: 8px;
       outline: none;
       cursor: pointer;
       font-size: 14px;
       transition: var(--transition);
   }
   select:focus, .input-text:focus {
       border-color: var(--accent-cyan);
       box-shadow: 0 0 5px color-mix(in srgb, var(--accent-cyan) 30%, transparent);
   }
   select option {
       background-color: var(--bg-panel);
       color: var(--text-main);
   }
   ```

6. **Предотвращение автозума на iOS (font-size >= 16px):**
   В файле `frontend/style.css` найдите секцию медиа-запросов `@media (max-width: 768px)` (или добавьте ее в конец файла, если ее нет) и примените принудительное задание шрифта не менее 16px для всех интерактивных полей ввода на мобильных вьюпортах:
   ```css
   @media (max-width: 768px) {
       input[type="text"],
       input[type="password"],
       input[type="email"],
       input[type="number"],
       input[type="search"],
       input[type="tel"],
       input[type="url"],
       input[type="datetime-local"],
       select,
       textarea,
       .cyber-input,
       .cyber-textarea,
       .input-textarea,
       #chat-input,
       #contact-search,
       .sidebar-search input,
       .sidebar-search-compact input {
           font-size: 16px !important;
       }
   }
   ```

7. **Тестирование изменений:**
   - Запустите `docker compose ps`, убедитесь, что контейнеры запущены.
   - Запустите команду тестирования E2E тестов: `npm run test:e2e`.
   - Убедитесь, что все тесты успешно проходят.

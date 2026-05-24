# Handoff Report — Explorer (Instance 3) — Mobile Adaptivity & Safe Areas

## 1. Observation (Наблюдения)

1. В каталоге `tests/e2e/` находятся файлы автотестов и конфигурации Playwright:
   - `tests/e2e/playwright.config.ts`
   - `tests/e2e/chat-pipeline.spec.ts`
   - `tests/e2e/mobile-rtc.spec.ts`
   - `tests/e2e/chat-media.spec.ts`
   - `tests/e2e/auth.spec.ts`

2. Конфигурация проектов эмуляции мобильных устройств в `tests/e2e/playwright.config.ts`:
   - Линия 37-42:
     ```typescript
     {
       name: 'Mobile Safari (iPhone 14)',
       use: { 
         ...devices['iPhone 14'],
         permissions: [],
       },
     },
     ```
   - Линия 44-56:
     ```typescript
     {
       name: 'Mobile Chrome (Pixel 7)',
       use: { 
         ...devices['Pixel 7'],
         launchOptions: {
           args: [
             '--use-fake-ui-for-media-stream',
             '--use-fake-device-for-media-stream',
             '--no-sandbox',
             '--ignore-certificate-errors',
           ],
         },
       },
     },
     ```

3. В файле `tests/e2e/chat-pipeline.spec.ts` мобильная верстка проверяется в рамках блока `test.describe('Chat Pipeline — Mobile 390×844')` (линии 487-541):
   - Инициализация мобильного вьюпорта:
     ```typescript
     viewport: { width: 390, height: 844 }
     ```
   - Тесты внутри этого блока проверяют только кнопку «Назад» и открытие опций:
     ```typescript
     test('M-01 Mobile back button is visible after opening chat', ...)
     test('M-02 Mobile back button closes chat and shows sidebar', ...)
     test('M-03 Three-dots opens and stopPropagation works', ...)
     ```
   - Проверки Safe Areas и виртуальной клавиатуры полностью отсутствуют.

4. В файле `frontend/messenger_app.js` реализован следующий код отслеживания visualViewport (линии 3-35):
   ```javascript
   let lastViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

   function setAppHeight() {
       const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
       const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
       document.documentElement.style.setProperty('--app-height', `${vh}px`);
       document.documentElement.style.setProperty('--app-offset', `${offset}px`);
       
       // Scroll adjustment for chat history so messages stick to the bottom when keyboard appears
       const historyEl = document.getElementById('chat-history');
       if (historyEl) {
           const isAtBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight < 50;
           const delta = lastViewportHeight - vh;
           
           requestAnimationFrame(() => {
               if (isAtBottom) {
                   historyEl.scrollTop = historyEl.scrollHeight;
               } else if (delta !== 0) {
                   historyEl.scrollTop += delta;
               }
           });
       }
       lastViewportHeight = vh;
   }
   
   if (window.visualViewport) {
       window.visualViewport.addEventListener('resize', setAppHeight);
       window.visualViewport.addEventListener('scroll', setAppHeight);
   }
   window.addEventListener('resize', setAppHeight);
   setAppHeight(); // Initial call
   ```

5. В файле `frontend/style.css` используются CSS-переменные для адаптации верстки:
   - Линия 22-23:
     ```css
     --app-height: 100dvh;
     --safe-bottom: env(safe-area-inset-bottom, 0px);
     ```
   - Линия 121-124:
     ```css
     height: var(--app-height, 100dvh);
     max-height: var(--app-height, 100dvh);
     transform: translateY(var(--app-offset, 0px));
     ```
   - Линия 795-798:
     ```css
     .chat-input-area {
         padding: 8px 12px;
         /* Pad above iOS Home Bar / Android gesture zone */
         padding-bottom: calc(8px + var(--safe-bottom));
     ```

## 2. Logic Chain (Логическая цепочка)

1. На основе анализа конфигурации `playwright.config.ts` и тестов в `chat-pipeline.spec.ts` установлено, что мобильная верстка сейчас проверяется только по критерию переключения окон (сайдбар/чат) по клику на кнопку «Назад» в мобильном вьюпорте `390×844` (Наблюдение 3).
2. На основе кода `frontend/messenger_app.js` и `frontend/style.css` установлено, что адаптация под виртуальную клавиатуру выполняется динамически в JS через подписку на `resize`/`scroll` объекта `window.visualViewport`, обновляя переменную `--app-height` и корректируя прокрутку `#chat-history` (Наблюдения 4 и 5).
3. Playwright запускает тесты в безголовом (headless) режиме Chromium/WebKit, где виртуальная клавиатура физически не появляется, из-за чего `visualViewport.height` не изменяется автоматически при фокусе на `#chat-input`.
4. Для эмуляции открытия клавиатуры в автотестах необходимо использовать метод программного уменьшения высоты вьюпорта страницы с помощью `page.setViewportSize({ width: 390, height: 544 })` (где высота `544 = 844 - 300px` высоты клавиатуры). Это сгенерирует событие `resize` на `window.visualViewport`, активируя логику пересчета высоты в приложении (Наблюдение 4).
5. Для эмуляции Safe Areas (`safe-area-inset-bottom`), которые также не выставляются Playwright по умолчанию, необходимо принудительно внедрить стиль со значением переменной `--safe-bottom` (например, `24px` вместо `0px`), считываемой в `style.css` (Наблюдение 5), используя `page.addStyleTag()`.

## 3. Caveats (Ограничения)

1. Тестирование с помощью `setViewportSize` эмулирует изменение высоты видимой области (visual viewport), аналогичное поведению при открытии клавиатуры на Android (где сжимается весь viewport). На iOS поведение Safari отличается: клавиатура накладывается поверх страницы в виде отдельного слоя (overlay), при этом `window.innerHeight` не изменяется, а уменьшается только `window.visualViewport.height`. Метод `setViewportSize` в Playwright изменяет одновременно оба параметра, однако он является единственным кроссбраузерным способом сэмулировать уменьшение рабочей зоны для JS-кода.
2. Внедрение Safe Areas через CSS-переменную `--safe-bottom` проверяет правильность вычисления отступов в CSS-коде приложения, но не проверяет интеграцию с реальным API Safe Areas ОС. Реальная поддержка Safe Areas на конкретных устройствах может зависеть от версий WebView на устройствах.

## 4. Conclusion (Заключение)

Для полной автоматизированной проверки Milestone 3 в E2E-тестах необходимо добавить новые сценарии тестирования в отдельный файл `tests/e2e/mobile-adaptivity.spec.ts`.
Эти тесты должны верифицировать:
1. Корректность изменения `padding-bottom` панели ввода сообщений `.chat-input-area` при эмуляции Safe Areas через инжекцию `--safe-bottom`.
2. Уменьшение рабочей зоны чата (высоты) до `--app-height` при фокусе и изменении размера вьюпорта (виртуальная клавиатура), а также сохранение автоскролла истории сообщений `#chat-history` до низа.

## 5. Verification Method (Метод проверки)

Независимая проверка работоспособности предлагаемых тестов может быть выполнена после их создания с помощью следующей команды:
`npx playwright test tests/e2e/mobile-adaptivity.spec.ts --project="Mobile Chrome (Pixel 7)"`
или через вызов PowerShell (в Windows-среде Antigravity):
`& "C:\Program Files\Git\bin\bash.exe" -c 'npx playwright test tests/e2e/mobile-adaptivity.spec.ts --project="Mobile Chrome (Pixel 7)"'`

Признак успешности прохождения:
- Локатор `.chat-input-area` увеличивает свой `padding-bottom` на величину заданного `--safe-bottom` (проверка в `MA-01`).
- CSS-переменная `--app-height` обновляется до фактической высоты уменьшенного вьюпорта, а скролл чата автоматически докручивается до последнего сообщения (проверка в `MA-02`).

# Handoff Report: Исследование стабильности макета и Visual Viewport (Milestone 3)

## 1. Observation (Наблюдения)

В ходе анализа файлов проекта `frontend/messenger_app.js`, `frontend/chat_core.js`, `frontend/style.css` и `frontend/chat.css` были сделаны следующие точные наблюдения:

1. **Двойное применение свойства `transform: translateY(var(--app-offset, 0px))`**:
   - В файле `frontend/style.css`, строка 124, свойство применяется к селектору `body`:
     ```css
     body {
         ...
         transform: translateY(var(--app-offset, 0px));
         ...
     }
     ```
   - В том же файле `frontend/style.css`, строка 3045, свойство применяется к селектору `body.skufenger-fullscreen .app-container`:
     ```css
     body.skufenger-fullscreen .app-container {
         ...
         transform: translateY(var(--app-offset, 0px));
         ...
     }
     ```
   - Элемент `.app-container` является непосредственным потомком `body` в разметке `messenger.html` (строка 336 и далее).

2. **Работа с `visualViewport` в `messenger_app.js`**:
   - Функция `setAppHeight` (строки 5-28 в `frontend/messenger_app.js`) вычисляет `offsetTop`:
     ```javascript
     const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
     ```
     и записывает его в CSS-переменную `--app-offset`:
     ```javascript
     document.documentElement.style.setProperty('--app-offset', `${offset}px`);
     ```
   - При этом отсутствуют вызовы для сброса скролла layout viewport (например, `window.scrollTo(0, 0)`), что позволяет мобильному браузеру осуществлять паразитный скролл при фокусе на `#chat-input`.

3. **Отсутствие поддержки `visualViewport` в `chat.html`**:
   - Файл `frontend/chat.html` подключает скрипт `chat.js` (строка 136) и стили `chat.css` (строка 13).
   - В файле `frontend/chat.js` отсутствуют слушатели на объекте `window.visualViewport`.
   - В файле `frontend/chat.css`, строка 5, высота `body.chat-app` установлена жестко:
     ```css
     body.chat-app {
         ...
         height: 100vh;
         height: 100dvh;
         ...
     }
     ```

4. **Использование Safe Areas в поле ввода**:
   - Нижний отступ у поля ввода `.premium-input-wrapper` рассчитывается с учетом `env(safe-area-inset-bottom)` даже при открытой клавиатуре:
     ```css
     body.skufenger-fullscreen .premium-input-wrapper {
         ...
         padding-bottom: calc(12px + var(--safe-bottom, 0px));
         ...
     }
     ```
     где `--safe-bottom` равен `env(safe-area-inset-bottom, 0px)` (строка 23 в `style.css`).

---

## 2. Logic Chain (Логическая цепочка)

1. **Смещение интерфейса (Двойная трансляция)**:
   - В `messenger.html` активен класс `skufenger-fullscreen` на `body`.
   - При фокусе на текстовое поле ввода `#chat-input` виртуальная клавиатура открывается, изменяя `visualViewport`.
   - Мобильный браузер (особенно iOS Safari) автоматически скроллит layout viewport вверх, из-за чего `window.visualViewport.offsetTop` становится больше 0 (например, 100px).
   - JS-функция `setAppHeight` записывает `--app-offset` = 100px.
   - Стили CSS применяют `transform: translateY(100px)` к `body` И `transform: translateY(100px)` к вложенному в него `.app-container`.
   - Суммарное смещение `.app-container` составляет `100px + 100px = 200px` вниз относительно видимой области.
   - **Вывод**: Это смещает всю рабочую область вниз, пряча поле ввода под клавиатуру и создавая пустую область сверху.

2. **Паразитный скролл layout viewport**:
   - Поскольку при изменении видимой области layout viewport скроллится браузером, и это никак не гасится с помощью `window.scrollTo(0, 0)`, значение `offsetTop` постоянно колеблется, вызывая прыжки интерфейса при вводе текста.
   - **Вывод**: Принудительный сброс скролла layout viewport в `setAppHeight` стабилизирует `offsetTop` на уровне 0, предотвращая любые нежелательные сдвиги.

3. **Перекрытие ввода в `chat.html`**:
   - При открытии клавиатуры в `chat.html` высота `100dvh` не меняется во многих мобильных браузерах (клавиатура накладывается поверх страницы).
   - Из-за отсутствия программного отслеживания `visualViewport` высота контейнера чата `.chat-layout` остается исходной, что приводит к перекрытию поля ввода `#message-input` клавиатурой.
   - **Вывод**: Необходимо программно адаптировать высоту `body` в `chat.js` под `window.visualViewport.height`.

4. **Избыточный Safe Area**:
   - При открытой клавиатуре нижняя часть экрана перекрывается ею, поэтому физического Home Bar iOS в нижней части окна браузера больше нет (он находится на уровне клавиатуры).
   - Оставленный отступ `safe-bottom` (до 34px) создает пустой зазор между клавиатурой и полем ввода.
   - **Вывод**: Динамическое отключение `safe-bottom` при открытой клавиатуре устранит зазор.

---

## 3. Caveats (Оговорки)

1. **Различия платформ**: Различные версии iOS (особенно iOS 15 vs 17) и Android (Chrome vs Samsung Internet) по-разному обрабатывают автоматический скролл при фокусе ввода. Потребуется кроссплатформенное тестирование.
2. **Экранная лупа и зум**: На мобильных устройствах при масштабировании (pinch-to-zoom) `visualViewport.offsetTop` также изменяется. Данный сценарий требует дополнительного тестирования, чтобы убедиться, что `window.scrollTo(0, 0)` не ломает ручной зум пользователя (хотя в `meta name="viewport"` прописано `user-scalable=no`).

---

## 4. Conclusion (Заключение)

Для обеспечения идеальной стабильности мобильного макета чата и предотвращения перекрытия клавиатурой полей ввода необходимо:
1. Удалить свойство `transform: translateY(var(--app-offset, 0px))` из селектора `body.skufenger-fullscreen .app-container` в `frontend/style.css` для исправления бага двойной трансляции.
2. Добавить `window.scrollTo(0, 0)` в функцию `setAppHeight` в `frontend/messenger_app.js` для предотвращения паразитного авто-скролла layout viewport.
3. Реализовать добавление/удаление класса `keyboard-open` на `body` при изменении размеров `visualViewport` и использовать его для обнуления Safe Area снизу.
4. Внедрить в `frontend/chat.js` логику отслеживания `visualViewport.height` для сжатия интерфейса простого чата.

Все детальные патчи и алгоритмы подробно описаны в отчете `analysis_report.md` в этой же директории.

---

## 5. Verification Method (Метод верификации)

1. **Проверка двойного сдвига (CSS)**:
   - Открыть `frontend/style.css` и убедиться, что свойство `transform: translateY(var(--app-offset...` присутствует только на селекторе `body` (строка 124) и отсутствует на `.app-container`.
2. **Эмуляция в Chrome DevTools / Safari Responsive Mode**:
   - Запустить приложение, переключиться в режим мобильного эмулятора (например, iPhone 12 Pro).
   - Активировать виртуальную клавиатуру в эмуляторе или сфокусироваться на поле ввода `#chat-input`.
   - Проверить, что `body.keyboard-open` успешно добавился в DOM и отступ под полем ввода снизился до `12px` (без учета safe-area).
   - Убедиться, что верхний заголовок чата `.chat-info` / `#chat-header` остается видимым и прижатым к верхней границе экрана, а поле ввода находится ровно над клавиатурой.
3. **Проверка в `chat.html`**:
   - Открыть страницу `chat.html` на мобильном эмуляторе, нажать на поле ввода сообщения.
   - Убедиться, что высота `body` сжимается до высоты клавиатурной зоны и поле ввода не перекрывается.

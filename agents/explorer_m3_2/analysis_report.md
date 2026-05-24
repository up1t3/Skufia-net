# Аналитический отчет: Исследование стабильности макета и интеграция Visual Viewport (Milestone 3)

## 1. Обзор архитектуры адаптивности и Safe Areas
В ходе исследования кодовой базы были проанализированы механизмы обеспечения мобильной адаптивности, безопасных зон (Safe Areas) и поведения интерфейса при открытии экранной клавиатуры. 

Основные компоненты:
1. **`messenger.html` / `style.css` / `messenger_app.js`**: Основной полноэкранный интерфейс мессенджера (SKUFenger).
   - Использует динамический расчет высоты через API `window.visualViewport` в `messenger_app.js`.
   - Внедряет CSS-переменные `--app-height` и `--app-offset` на уровне `:root` (`document.documentElement`).
   - Ограничивает размеры контейнеров `.app-container`, `.chat-layout` и `.viewport` под высоту `--app-height`.
   - Использует безопасные зоны `env(safe-area-inset-bottom)` для нижнего отступа поля ввода `.premium-input-wrapper`.
2. **`chat.html` / `chat.css` / `chat.js`**: Вспомогательный (или устаревший) трехпанельный интерфейс чата.
   - Полагается исключительно на CSS `height: 100dvh` для `body` и не отслеживает `visualViewport` программно.

---

## 2. Выявленные проблемы и баги

### А. Баг двойной трансляции (Double Translation Bug)
**Локализация:**
- `frontend/style.css`, строка 124 (для `body`):
  ```css
  body {
      ...
      transform: translateY(var(--app-offset, 0px));
  }
  ```
- `frontend/style.css`, строка 3045 (для `body.skufenger-fullscreen .app-container`):
  ```css
  body.skufenger-fullscreen .app-container {
      ...
      transform: translateY(var(--app-offset, 0px));
  }
  ```

**Суть проблемы:**
При активации клавиатуры на мобильном устройстве (особенно iOS Safari) браузер сдвигает layout viewport вверх. В ответ на это обработчик `setAppHeight` в `messenger_app.js` вычисляет `window.visualViewport.offsetTop` и присваивает значение переменной `--app-offset`.
Так как `.app-container` находится внутри `body`, и к ОБОИМ элементам применяется `transform: translateY(var(--app-offset))`, сдвиг вниз происходит дважды. Например, при сдвиге в 100px контейнер сдвигается на 200px.
**Результат:** Верхняя панель уходит далеко вниз, оставляя пустую черную область сверху, а нижняя панель ввода (`.premium-input-wrapper`) полностью скрывается под клавиатурой или уходит за пределы экрана.

---

### Б. Отсутствие поддержки Visual Viewport в простом чате (`chat.html`)
**Локализация:** `frontend/chat.js` и `frontend/chat.css`.
**Суть проблемы:**
Контейнер `body.chat-app` имеет фиксированную высоту `100dvh`. На мобильных устройствах открытие клавиатуры не изменяет высоту `dvh` во всех браузерах (в частности, в iOS Safari высота `dvh` остается равной высоте экрана без клавиатуры). 
Так как обработчики событий `visualViewport` отсутствуют, интерфейс не сжимается. Браузер принудительно скроллит layout viewport вверх, пытаясь показать сфокусированный `textarea`, что полностью ломает закрепленный заголовок чата (`.chat-header`) и сдвигает всю сетку.

---

### В. Проблема избыточного Safe Area при открытой клавиатуре
**Локализация:** `frontend/style.css`, строки 1564 и 3208.
**Суть проблемы:**
При закрытой клавиатуре поле ввода `.premium-input-wrapper` использует `padding-bottom: calc(12px + var(--safe-bottom))` для предотвращения перекрытия системной полосой Home Bar на iOS.
Однако при открытии клавиатуры системная Safe Area перекрывается клавиатурой. Текущие стили продолжают добавлять `safe-bottom` (обычно от 21px до 34px на iPhone), из-за чего над клавиатурой появляется ненужная пустая полоса, уменьшающая полезную область переписки.

---

## 3. Разработанная стратегия плавного сжатия рабочей области чата

Для обеспечения стабильного макета при открытии виртуальной клавиатуры предлагается следующая стратегия:

### Шаг 1. Исправление двойной трансляции
Необходимо убрать свойство `transform: translateY` с `.app-container` в файле `style.css` на строке 3045. Трансляция должна остаться только на `body`, чтобы сдвигать всю страницу целиком, включая фоновые оверлеи и модальные окна.

### Шаг 2. Блокирование автоматического скролла браузера (Force Reset Layout Viewport)
В обработчик `setAppHeight` в `messenger_app.js` необходимо внедрить вызов `window.scrollTo(0, 0)`. Это принудительно возвращает layout viewport в начальную координату, гася паразитный сдвиг браузера.
При этом переменная `--app-offset` станет равной 0, что устранит необходимость в физическом сдвиге через `translateY` и стабилизирует верстку.

### Шаг 3. Динамическое управление Safe Area при открытии клавиатуры
В JS-коде определять состояние открытия клавиатуры (когда `window.visualViewport.height < window.innerHeight - 150`) и вешать на `body` класс `keyboard-open`.
В CSS использовать этот класс для обнуления Safe Area снизу у поля ввода чата.

### Шаг 4. Адаптация Visual Viewport для `chat.html`
Внедрить в `chat.js` аналогичный компактный обработчик изменения видимой области, который будет динамически сжимать высоту `body.chat-app` под высоту `visualViewport.height`.

---

## 4. Конкретные предложения по изменению кода (Diff-пакет)

### Патч 1: Исправление двойного сдвига и избыточных отступов Safe Area в `style.css`

```diff
<<<<
body.skufenger-fullscreen .app-container {
    padding: 0 !important;
    margin: 0 !important;
    height: var(--app-height, 100dvh);
    max-height: var(--app-height, 100dvh);
    transform: translateY(var(--app-offset, 0px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    gap: 0 !important;
}
====
body.skufenger-fullscreen .app-container {
    padding: 0 !important;
    margin: 0 !important;
    height: var(--app-height, 100dvh);
    max-height: var(--app-height, 100dvh);
    /* Устранено дублирование transform: translateY, так как оно уже применяется к body */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    gap: 0 !important;
}
>>>>
```

```diff
<<<<
body.skufenger-fullscreen .premium-input-wrapper {
    padding: 12px 16px;
    padding-bottom: calc(12px + var(--safe-bottom, 0px));
    background: color-mix(in srgb, var(--bg-dark) 90%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid color-mix(in srgb, var(--border-metal) 30%, transparent);
}
====
body.skufenger-fullscreen .premium-input-wrapper {
    padding: 12px 16px;
    padding-bottom: calc(12px + var(--safe-bottom, 0px));
    background: color-mix(in srgb, var(--bg-dark) 90%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid color-mix(in srgb, var(--border-metal) 30%, transparent);
    transition: padding-bottom 0.1s ease-out; /* Плавное скрытие safe-area */
}

/* Сброс Safe Area при открытой клавиатуре */
body.keyboard-open .premium-input-wrapper {
    padding-bottom: 12px !important;
}
>>>>
```

### Патч 2: Устранение авто-скролла и управление классом `keyboard-open` в `messenger_app.js`

```diff
<<<<
    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
        document.documentElement.style.setProperty('--app-offset', `${offset}px`);
        
        // Scroll adjustment for chat history so messages stick to the bottom when keyboard appears
        const historyEl = document.getElementById('chat-history');
        if (historyEl) {
            // Check if user is currently at the bottom (within 50px tolerance)
            const isAtBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight < 50;
            const delta = lastViewportHeight - vh;
            
            // Wait for next animation frame so the DOM updates clientHeight
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
====
    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
        
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
        document.documentElement.style.setProperty('--app-offset', `${offset}px`);
        
        // Сброс прокрутки layout viewport (предотвращает прыжки интерфейса на iOS)
        if (offset > 0) {
            window.scrollTo(0, 0);
        }
        
        // Определение открытой клавиатуры (высота экрана уменьшилась более чем на 150px)
        const isKeyboard = vh < window.innerHeight - 150;
        if (isKeyboard) {
            document.body.classList.add('keyboard-open');
        } else {
            document.body.classList.remove('keyboard-open');
        }
        
        // Scroll adjustment for chat history so messages stick to the bottom when keyboard appears
        const historyEl = document.getElementById('chat-history');
        if (historyEl) {
            // Check if user is currently at the bottom (within 50px tolerance)
            const isAtBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight < 50;
            const delta = lastViewportHeight - vh;
            
            // Wait for next animation frame so the DOM updates clientHeight
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
>>>>
```

### Патч 3: Добавление поддержки `visualViewport` в `chat.js` (простой чат)

В конец файла `frontend/chat.js` (внутри обработчика `DOMContentLoaded`) рекомендуется добавить:

```javascript
    // 7. Visual Viewport Adaptive Resize (Mobile Keyboard Fix)
    function adjustChatViewport() {
        if (!window.visualViewport) return;
        const vh = window.visualViewport.height;
        const offset = window.visualViewport.offsetTop;
        
        // Устанавливаем высоту body равной высоте видимой области
        document.body.style.height = `${vh}px`;
        
        // Принудительно сбрасываем скролл layout viewport
        if (offset > 0) {
            window.scrollTo(0, 0);
        }
        
        // Прокрутка чата вниз при изменении размеров
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', adjustChatViewport);
        window.visualViewport.addEventListener('scroll', adjustChatViewport);
        adjustChatViewport(); // Первичный запуск
    }
```
И в файле `chat.css` добавить плавный переход высоты:
```css
body.chat-app {
    ...
    transition: height 0.1s ease-out;
}
```
Это позволит макету простого чата мгновенно сжиматься при фокусе на `#message-input` и не допускать наложения виртуальной клавиатуры на текстовое поле.

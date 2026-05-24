# ТЕХНИЧЕСКИЙ ОТЧЕТ ПО ИССЛЕДОВАНИЮ ЖЕСТОВ СВАЙПА (SWIPE-TO-BACK)
**Milestone 4 — Реализация плавного сдвига `.chat-main`**

## 1. Введение и цели исследования
Целью данного исследования является разработка детального плана реализации Milestone 4: Жесты свайпа (Swipe-to-Back).
Требуется спроектировать и подготовить спецификацию для плавного сдвига блока `.chat-main` за пальцем при свайпе слева направо на мобильных устройствах (экраны `<= 768px`) с порогом закрытия чата в `120px`.

---

## 2. Анализ структуры HTML и CSS-стилей

### 2.1 Разметка интерфейса (messenger.html)
В основном файле интерфейса `frontend/messenger.html` макет состоит из контейнера `.chat-layout` внутри основного вьюпорта `#view-messages`:
```html
<div id="view-messages" class="view">
    <div class="chat-layout">
        <!-- Левая панель: Список чатов / папки -->
        <div class="chat-sidebar">
            ...
        </div>
        <!-- Правая панель: Окно активного чата -->
        <div class="chat-main">
            <!-- Шапка чата -->
            <div id="chat-header">
                <button id="back-btn" class="back-btn" onclick="window.closeChatMobile()">←</button>
                ...
            </div>
            <!-- История сообщений -->
            <div id="chat-history">...</div>
            <!-- Панель ввода -->
            <div class="chat-input-area">...</div>
        </div>
    </div>
</div>
```

### 2.2 CSS-стилизация мобильной версии (style.css)
Для мобильных устройств (ширина экрана `<= 768px`) в режиме полного экрана (`body.skufenger-fullscreen`) стили определены следующим образом:
* **`.chat-sidebar`**:
  * Имеет ширину `100%`, позиционируется абсолютно (`top: 0; left: 0; bottom: 0;`).
  * Имеет плавный переход: `transition: transform 0.3s ease;`.
  * При открытом чате (`.chat-layout.chat-open`) сдвигается влево: `transform: translateX(-100%);`.
* **`.chat-main`**:
  * Позиционируется абсолютно поверх сайдбара (`z-index: 50`), занимает `100%` ширины.
  * По умолчанию сдвинут вправо за пределы экрана: `transform: translateX(100%);`.
  * Имеет плавный переход: `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);`.
  * При открытом чате (`.chat-layout.chat-open`) выдвигается на экран: `transform: translateX(0);`.

---

## 3. Анализ существующей логики переключения чатов

1. **Открытие чата**:
   При клике на чат в сайдбаре срабатывает функция `selectChatRoom(...)` в `frontend/chat_core.js`, которая вешает класс `.chat-open` на элемент `.chat-layout`. Благодаря CSS-переходу `.chat-main` плавно выдвигается справа налево (`translateX(100%) -> translateX(0)`).
2. **Закрытие чата**:
   Вызывается функция `window.closeChatMobile()` в `frontend/messenger_app.js`, которая:
   - Удаляет класс `.chat-open` с `.chat-layout`.
   - Запускает `history.back()`, если это необходимо для синхронизации с History API.
   - Благодаря удалению `.chat-open` запускается обратный CSS-переход `.chat-main` в положение `translateX(100%)`.

---

## 4. Спецификация и проектирование жеста Swipe-to-Back

Для реализации плавного сдвига за пальцем необходимо перехватывать touch-события непосредственно на элементе `.chat-main` и управлять его свойством `transform` в обход CSS-перехода во время перетаскивания.

### 4.1 Алгоритм отслеживания touch-событий
1. **Касание (`touchstart`)**:
   - Жест активируется только при ширине экрана `<= 768px`.
   - Жест должен начинаться строго от левого края чата (например, в пределах первых `50px` экрана: `clientX <= 50`). Это предотвращает случайные закрытия при горизонтальной прокрутке внутри чата (например, в блоках кода или галереях).
   - Запоминаются начальные координаты `startX` и `startY`.
   - У `.chat-main` временно отключается CSS transition (`transition = 'none'`), чтобы элемент двигался без задержки.
2. **Движение (`touchmove`)**:
   - Вычисляется разница `diffX = currentX - startX` и `diffY = currentY - startY`.
   - Выполняется валидация жеста: если движение имеет горизонтальный вектор (например, `diffX > 10` и `diffX > Math.abs(diffY) * 1.5`), жест распознается как свайп-назад. В противном случае, если зафиксировано вертикальное движение, жест помечается как вертикальный скролл и свайп блокируется.
   - При активном свайпе вызывается `e.preventDefault()` для предотвращения системного скролла.
   - Значение сдвига рассчитывается как `translateX = Math.max(0, diffX)` (сдвиг только вправо).
   - Отрисовка сдвига выполняется внутри `requestAnimationFrame` для плавной работы на экранах с высокой частотой обновления (90/120Hz).
3. **Завершение (`touchend` / `touchcancel`)**:
   - Восстанавливается стандартный CSS transition.
   - Проверяется порог сдвига в `120px`:
     - **Если `translateX > 120px`**: чат закрывается. Сбрасывается инлайновый `transform = ''` и вызывается функция `window.closeChatMobile()`. Стандартный CSS transition завершит сдвиг `.chat-main` до `translateX(100%)`.
     - **Если `translateX <= 120px`**: чат возвращается в исходное состояние. Сбрасывается инлайновый `transform = ''`. Благодаря восстановленному CSS transition чат плавно вернется в `translateX(0)`.

### 4.2 Улучшенный UX (Эффект параллакса и затемнения сайдбара)
Для создания нативного эффекта (подобного Telegram/iOS):
* Во время свайпа `.chat-sidebar` тоже плавно сдвигается из положения `-30%` (или `-100%`) к `0%` с коэффициентом параллакса `0.3`.
  ```javascript
  const sidebarOffset = -30 + (currentX / window.innerWidth) * 30; // от -30% до 0%
  chatSidebar.style.transform = `translateX(${sidebarOffset}%)`;
  ```
* Сайдбар плавно осветляется (если он был слегка затемнен) во время свайпа с помощью свойства `filter: brightness`.
  ```javascript
  const brightness = 0.7 + (currentX / window.innerWidth) * 0.3; // от 0.7 до 1.0
  chatSidebar.style.filter = `brightness(${brightness})`;
  ```

---

## 5. Предлагаемый код реализации (swipe_gestures.js)

Ниже представлен готовый к внедрению JS-модуль, который может быть либо добавлен в конец `frontend/messenger_app.js`, либо подключен отдельным файлом:

```javascript
(function() {
    document.addEventListener('DOMContentLoaded', () => {
        const chatLayout = document.querySelector('.chat-layout');
        const chatMain = document.querySelector('.chat-main');
        const chatSidebar = document.querySelector('.chat-sidebar');

        if (!chatLayout || !chatMain || !chatSidebar) return;

        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isSwiping = false;
        let isScrolling = false;

        const SWIPE_THRESHOLD = 120; // Порог закрытия в px
        const EDGE_THRESHOLD = 50;   // Зона активации от левого края в px

        chatMain.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return;
            if (!chatLayout.classList.contains('chat-open')) return;

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;

            // Свайп работает только от левого края
            if (startX > EDGE_THRESHOLD) {
                isSwiping = false;
                return;
            }

            isSwiping = false;
            isScrolling = false;
            currentX = 0;

            // Отключаем анимацию для отзывчивого перетаскивания
            chatMain.style.transition = 'none';
            chatSidebar.style.transition = 'none';
        }, { passive: true });

        chatMain.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 768) return;
            if (!chatLayout.classList.contains('chat-open')) return;
            if (isScrolling) return;

            const touch = e.touches[0];
            const diffX = touch.clientX - startX;
            const diffY = touch.clientY - startY;

            // Определение направления жеста
            if (!isSwiping && !isScrolling) {
                if (diffX > 10 && diffX > Math.abs(diffY) * 1.5) {
                    isSwiping = true;
                } else if (Math.abs(diffY) > 10 || diffX < -10) {
                    isScrolling = true;
                    return;
                }
            }

            if (isSwiping) {
                if (e.cancelable) e.preventDefault();
                currentX = Math.max(0, diffX);

                requestAnimationFrame(() => {
                    // Сдвигаем окно чата
                    chatMain.style.transform = `translateX(${currentX}px)`;
                    
                    // Эффект параллакса для сайдбара (выезжает из -30% к 0%)
                    const sidebarPercent = -30 + (currentX / window.innerWidth) * 30;
                    chatSidebar.style.transform = `translateX(${sidebarPercent}%)`;
                    
                    // Плавное изменение яркости сайдбара (эффект затемнения)
                    const brightness = 0.7 + (currentX / window.innerWidth) * 0.3;
                    chatSidebar.style.filter = `brightness(${brightness})`;
                });
            }
        }, { passive: false });

        const handleTouchEnd = () => {
            if (window.innerWidth > 768) return;
            if (!isSwiping) return;

            isSwiping = false;

            // Возвращаем стандартные CSS-переходы
            chatMain.style.transition = '';
            chatSidebar.style.transition = '';
            chatSidebar.style.filter = '';

            if (currentX > SWIPE_THRESHOLD) {
                // Закрываем чат
                chatMain.style.transform = '';
                chatSidebar.style.transform = '';
                if (typeof window.closeChatMobile === 'function') {
                    window.closeChatMobile();
                } else {
                    chatLayout.classList.remove('chat-open');
                }
            } else {
                // Возвращаем чат на место
                chatMain.style.transform = '';
                chatSidebar.style.transform = '';
            }
        };

        chatMain.addEventListener('touchend', handleTouchEnd, { passive: true });
        chatMain.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    });
})();
```

---

## 6. Тестирование и верификация

### 6.1 Ручное тестирование в режиме эмуляции мобильных устройств (Chrome/Firefox DevTools):
1. Открыть панель разработчика (F12), включить Device Mode (эмуляция смартфона, например iPhone 12, ширина <= 768px).
2. Зайти в аккаунт, открыть любой чат. Убедиться, что добавился класс `.chat-open`, а `.chat-main` отобразился на весь экран.
3. Провести свайп от левой границы экрана (в пределах 50px от края) вправо.
4. **Ожидаемый результат**: Блок `.chat-main` плавно сдвигается вправо вслед за курсором/пальцем. Блок `.chat-sidebar` сзади медленно выдвигается вправо (эффект параллакса).
5. Отпустить мышь/палец при сдвиге менее 120px.
6. **Ожидаемый результат**: Чат плавно возвращается на исходную позицию (`translateX(0)`).
7. Сделать свайп вправо на расстояние более 120px и отпустить.
8. **Ожидаемый результат**: Чат плавно закрывается (улетает вправо, `.chat-open` удаляется), пользователь возвращается к списку чатов в сайдбаре.

### 6.2 Автоматизированные тесты стабильности UI:
В проекте присутствует файл автоматических тестов `frontend/test_ui_stability.js`. Для автоматического тестирования жеста свайпа можно расширить его с помощью библиотеки Puppeteer, симулируя touch-события:
```javascript
// Пример интеграции в Puppeteer тесты:
const chatMainHandle = await page.$('.chat-main');
const box = await chatMainHandle.boundingBox();

// TouchStart в левой части чата
await page.touchscreen.tap(box.x + 10, box.y + 100); 
// Симуляция движения вправо на 150px (больше порога 120px)
await page.touchscreen.swipe(box.x + 10, box.y + 100, box.x + 160, box.y + 100, 5); 

// Проверка, что класс chat-open удалился
const chatClosed = await page.$eval('.chat-layout', el => !el.classList.contains('chat-open'));
console.log('Свайп-назад сработал:', chatClosed);
```

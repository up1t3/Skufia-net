# Технический отчет: Исследование и проектирование архитектуры Swipe-to-Back (Milestone 4)

## 1. Анализ текущего состояния кодовой базы

В ходе исследования структуры и скриптов в каталоге `frontend/` были выявлены следующие особенности обработки тач-событий и переходов:

### 1.1. Текущие обработчики свайпа
В файле `frontend/chat.js` (строки 102–126) присутствует примитивная реализация жеста свайпа:
```javascript
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);

    function handleSwipe() {
        if (window.innerWidth <= 768) {
            const swipeDistance = touchEndX - touchStartX;
            if (swipeDistance > 50) {
                chatLayout.classList.remove('chat-open');
            }
        }
    }
```
**Недостатки текущей реализации:**
1. **Глобальный перехват:** Слушатели событий вешаются на весь объект `document`. Это приводит к срабатыванию жеста в любой части экрана (включая текстовые поля ввода, списки и кнопки).
2. **Отсутствие визуального фидбека:** Жест срабатывает мгновенно по событию `touchend`. Экран чата не сдвигается за пальцем пользователя в процессе движения (нет `touchmove` с `transform: translateX`), что делает интерфейс дискретным и несовременным.
3. **Конфликт со скроллом:** Отсутствует фильтрация направления движения. Свайп по диагонали или неаккуратный вертикальный скролл истории сообщений может ошибочно распознаться как свайп вправо и закрыть чат.
4. **Нарушение истории навигации:** Класс `chat-open` удаляется напрямую (строка 119) в обход функции `window.closeChatMobile()`, которая управляет историей браузера (`history.back()`). Это может приводить к рассогласованию навигационного состояния в PWA-режиме.

### 1.2. Качественная реализация свайпов в сайдбаре
В файле `frontend/chat_core.js` (строки 769–822) реализован свайп влево для закрепления/открепления чата в списке комнат:
- Используется проверка угла жеста для исключения вертикального скролла:
  `if (!isSwiping && diffY > 5 && diffY > Math.abs(diffX)) { isScrolling = true; return; }`
- Этот алгоритм был взят за основу при проектировании новой архитектуры свайпа для закрытия чата.

### 1.3. Логика закрытия чата и история
В `frontend/messenger_app.js` (строки 1617–1633) определена функция закрытия чата на мобильных устройствах:
```javascript
    window.closeChatMobile = function(fromHistory = false) {
        const chatLayout = document.querySelector('.chat-layout');
        if (!chatLayout) return;

        const isFullscreen = document.body.classList.contains('skufenger-fullscreen');
        const isMobile = window.innerWidth <= 768;

        if (chatLayout.classList.contains('chat-open')) {
            chatLayout.classList.remove('chat-open');
        }

        if (fromHistory !== true && (isMobile || isFullscreen) && !navigator.webdriver) {
            try { history.back(); } catch(e) {}
        }
    };
```
Событие `popstate` на уровне `window` (строки 1886–1905) отслеживает переходы по истории назад и автоматически удаляет или добавляет класс `chat-open` в зависимости от состояния истории.

---

## 2. Проектирование JS-архитектуры Swipe-to-Back

Для реализации современного, отзывчивого и стабильного жеста Swipe-to-Back разработана следующая архитектура.

### 2.1. Инициализация и область видимости
- Обработчики событий тача привязываются исключительно к элементу `.chat-main` (а не ко всему `document`), так как жест должен работать только в активном окне чата.
- Жест активируется только при мобильной ширине экрана (`window.innerWidth <= 768`) и когда чат открыт (наличие класса `.chat-open` у `.chat-layout`).

### 2.2. Защита от конфликтов (Edge Swipe)
Для предотвращения конфликтов со стандартными взаимодействиями внутри чата (скролл сообщений, горизонтальный скролл галерей картинок, выделение текста, сдвиг курсора в поле ввода):
1. **Edge-фильтрация:** Жест свайпа начинает отслеживаться только в том случае, если точка начала касания находится у левого края экрана: `startX < 35px`.
2. **Исключение интерактивных элементов:** Если касание началось на элементах ввода (`input`, `textarea`), кнопках (`button`, `.mic-btn`), чекбоксах или ссылках, жест полностью игнорируется.
3. **Фильтрация по углу движения:** В обработчике `touchmove` проверяется соотношение горизонтального смещения вправо (`diffX`) и вертикального смещения (`diffY`). Если вертикальный скролл начался раньше или преобладает (`diffY > diffX`), то свайп блокируется (`isScrolling = true`). Если преобладает горизонтальное смещение (`diffX > diffY`), то включается режим свайпа (`isSwiping = true`), и стандартное поведение скролла страницы отменяется через `e.preventDefault()`.

### 2.3. Плавная визуализация (Transform & Transition)
- В момент активации свайпа (`isSwiping = true`) отключается CSS transition на `.chat-main` (и на `.chat-sidebar` в PWA-режиме) путем добавления инлайнового стиля `transition = 'none'`.
- Во время движения пальца (`touchmove`) к `.chat-main` применяется инлайновый стиль `transform = translateX(diffX px)`. Сдвиг ограничивается от `0` до ширины экрана.
- В PWA-режиме (когда `body` имеет класс `.skufenger-fullscreen`) сайдбар `.chat-sidebar` сдвинут на `translateX(-100%)`. Чтобы создать эффект нативного сдвига, сайдбар плавно выдвигается из-под чата пропорционально сдвигу чата: от `-100%` до `0%` (`transform = translateX(sidebarTranslateX %)`).

### 2.4. Завершение и отмена жеста
При наступлении события `touchend` восстанавливаются CSS-переходы, и рассчитывается порог срабатывания на основе:
- **Дистанции:** Сдвиг чата больше 1/3 ширины экрана (`diffX > window.innerWidth / 3`).
- **Скорости:** Скорость движения пальца превышает `0.3 px/ms`.

Если порог пройден:
1. `.chat-main` плавно сдвигается до `translateX(100%)`.
2. Сайдбар `.chat-sidebar` сдвигается до `translateX(0)`.
3. Вызывается `window.closeChatMobile(false)`, которая удаляет класс `.chat-open` и осуществляет переход по истории назад (`history.back()`).
4. Через тайм-аут 250мс (время окончания анимации перехода) инлайновые стили `transform` и `transition` полностью очищаются для возврата управления CSS-классам.

Если жест отменен:
1. Элементы плавно возвращаются в исходное открытое состояние (`translateX(0)` для чата, `translateX(-100%)` для сайдбара).
2. Через 250мс инлайновые стили очищаются.

---

## 3. Предлагаемый патч для реализации

Для интеграции новой архитектуры жестов Swipe-to-Back предлагается заменить старый код в `frontend/chat.js` (строки 101–127) на следующий блок кода.

### Дифф изменений в `frontend/chat.js`

```markdown
<<<< BEFORE (строки 101-127)
    // Mobile Swipe Gestures to close sidebar / go back
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);

    function handleSwipe() {
        if (window.innerWidth <= 768) {
            const swipeDistance = touchEndX - touchStartX;
            // Swipe Right (Open sidebar / go back to list)
            if (swipeDistance > 50) {
                chatLayout.classList.remove('chat-open');
            }
            // Swipe Left (Open chat) - usually clicking an item does this, but could be added if needed
            // if (swipeDistance < -50) {
            //     chatLayout.classList.add('chat-open');
            // }
        }
    }
==== AFTER
    // Mobile Swipe Gestures to close sidebar / go back (Milestone 4 Swipe-to-Back)
    const initSwipeToBack = () => {
        const chatMain = document.querySelector('.chat-main');
        const chatLayout = document.querySelector('.chat-layout');
        const sidebar = document.querySelector('.chat-sidebar');
        if (!chatMain || !chatLayout) return;

        let startX = 0;
        let startY = 0;
        let diffX = 0;
        let diffY = 0;
        let isSwiping = false;
        let isScrolling = false;
        let startTime = 0;
        
        const EDGE_THRESHOLD = 35; // Зона Edge Swipe (35px от левого края)
        const VELOCITY_THRESHOLD = 0.3; // Порог скорости свайпа (px/ms)

        chatMain.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return;
            if (!chatLayout.classList.contains('chat-open')) return;

            // Исключаем интерактивные элементы и поля ввода
            const target = e.target;
            if (target.closest('input, textarea, button, select, [role="button"], .cyber-checkbox, .mic-btn, .room-delete-btn')) {
                return;
            }

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            // Жест должен начинаться только у левого края экрана
            if (startX > EDGE_THRESHOLD) return;

            isSwiping = false;
            isScrolling = false;
            diffX = 0;
            diffY = 0;
            startTime = Date.now();
        }, { passive: true });

        chatMain.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 768 || isScrolling) return;
            if (startX > EDGE_THRESHOLD) return;

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;

            diffX = currentX - startX;
            diffY = Math.abs(currentY - startY);

            if (!isSwiping && !isScrolling) {
                // Если вертикальный сдвиг преобладает, это скролл истории сообщений
                if (diffY > 5 && diffY > diffX) {
                    isScrolling = true;
                    return;
                }
                // Если горизонтальный сдвиг вправо преобладает, активируем свайп
                if (diffX > 5 && diffX > diffY) {
                    isSwiping = true;
                    chatMain.style.transition = 'none';
                    if (sidebar) sidebar.style.transition = 'none';
                }
            }

            if (isSwiping) {
                // Отменяем стандартный скролл страницы
                if (e.cancelable) e.preventDefault();

                const translateX = Math.max(0, diffX);
                chatMain.style.transform = `translateX(${translateX}px)`;

                // Синхронный параллельный сдвиг сайдбара в полноэкранном PWA-режиме
                const isFullscreen = document.body.classList.contains('skufenger-fullscreen');
                if (isFullscreen && sidebar) {
                    const width = window.innerWidth;
                    const progress = Math.min(1, translateX / width);
                    const sidebarTranslateX = -100 + (progress * 100);
                    sidebar.style.transform = `translateX(${sidebarTranslateX}%)`;
                }
            }
        }, { passive: false });

        chatMain.addEventListener('touchend', (e) => {
            if (!isSwiping) return;

            isSwiping = false;

            // Восстанавливаем CSS transition для плавного доведения
            chatMain.style.transition = 'transform 0.25s cubic-bezier(0.1, 0.8, 0.2, 1)';
            if (sidebar) sidebar.style.transition = 'transform 0.25s cubic-bezier(0.1, 0.8, 0.2, 1)';

            const width = window.innerWidth;
            const velocity = diffX / (Date.now() - startTime);
            const shouldClose = diffX > width / 3 || velocity > VELOCITY_THRESHOLD;

            if (shouldClose) {
                // Доводим сдвиг до конца (100% ширины)
                chatMain.style.transform = 'translateX(100%)';
                if (sidebar) sidebar.style.transform = 'translateX(0)';

                // Закрываем чат с интеграцией истории
                if (typeof window.closeChatMobile === 'function') {
                    window.closeChatMobile(false);
                } else {
                    chatLayout.classList.remove('chat-open');
                }

                // Полностью очищаем инлайновые стили после окончания анимации
                setTimeout(() => {
                    chatMain.style.transform = '';
                    chatMain.style.transition = '';
                    if (sidebar) {
                        sidebar.style.transform = '';
                        sidebar.style.transition = '';
                    }
                }, 250);
            } else {
                // Возвращаем чат на место
                chatMain.style.transform = 'translateX(0)';
                
                const isFullscreen = document.body.classList.contains('skufenger-fullscreen');
                if (isFullscreen && sidebar) {
                    sidebar.style.transform = 'translateX(-100%)';
                }

                // Очищаем инлайновые стили после возврата
                setTimeout(() => {
                    chatMain.style.transform = '';
                    chatMain.style.transition = '';
                    if (sidebar) {
                        sidebar.style.transform = '';
                        sidebar.style.transition = '';
                    }
                }, 250);
            }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSwipeToBack);
    } else {
        initSwipeToBack();
    }
>>>>
```

---

## 4. Оценка влияния изменений (Blast Radius)

### 4.1. Влияние на DOM и стили
- Предлагаемое решение использует только динамические инлайновые свойства стиля `transform` и `transition`. Никакие постоянные изменения структуры DOM-дерева не производятся.
- Очистка инлайновых стилей по тайм-ауту 250мс гарантирует, что состояние интерфейса возвращается к стандартному CSS-описанию, предотвращая баги при ресайзе экрана или смене ориентации устройства.

### 4.2. Безопасность навигации и история PWA
- Использование `window.closeChatMobile(false)` гарантирует правильную синхронизацию с историей браузера. При свайпе вызывается `history.back()`, что корректно обрабатывает стэк навигации.
- Жест работает гармонично с кнопкой "Назад" в шапке чата (`.mobile-back-btn`), так как оба метода используют единый системный путь закрытия.

### 4.3. Совместимость с компонентами интерфейса
- **Поле ввода сообщений (`#chat-input`):** Исключено из области инициализации жеста, благодаря чему перемещение курсора пальцем внутри текста не приводит к закрытию чата.
- **Бабблы сообщений (`.msg-bubble`):** Жест не мешает лонг-тачам на бабблы для вызова контекстного меню реакций/действий, так как свайп работает только от левого края (Edge Swipe).
- **Скролл истории (`#chat-history`):** Логика распознавания угла жеста гарантирует, что прокрутка сообщений вверх/вниз не будет прерываться или вызывать ложное срабатывание Swipe-to-Back.

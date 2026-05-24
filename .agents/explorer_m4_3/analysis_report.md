# Отчет об исследовании реализации жестов свайпа (Swipe-to-Back) и E2E-тестирования в Playwright

Этот отчет содержит анализ кодовой базы Skufia-net для внедрения поддержки жестов свайпа (Swipe-to-Back) и детальные инструкции по написанию E2E-тестов в среде Playwright для верификации этой функциональности.

---

## 1. Наблюдения (Observations)

### 1.1 Текущая тестовая инфраструктура (Playwright)
В проекте уже существуют тесты мобильной адаптивности, расположенные в `tests/e2e/mobile-adaptivity.spec.ts`.
- **Viewport**: В `beforeEach` тесты инициализируют контекст браузера с мобильными параметрами `viewport: { width: 390, height: 844 }` (эмуляция мобильного экрана).
- **Эмулируемые устройства**: Конфигурационный файл `tests/e2e/playwright.config.ts` содержит профили проектов для мобильных устройств:
  - `Mobile Safari (iPhone 14)` — эмуляция WebKit на iOS.
  - `Mobile Chrome (Pixel 7)` — эмуляция Chromium на Android.
- **Подготовка сессии**:
  - Метод `beforeEach` автоматически регистрирует двух тестовых пользователей (`USER_A` и `USER_B`), выполняет вход под `USER_A`, переходит по адресу `/messenger.html`, дожидается инициализации `chat_core.js` (проверкой `typeof window.openFabHub === 'function'`), создает приватную комнату для переписки с `USER_B` и кликает по первому элементу в списке чатов для его открытия.
  - Метод `openFirstChat` ожидает появление класса `.chat-open` у элемента `.chat-layout` (время ожидания до 6 секунд).

### 1.2 Архитектура и верстка мобильного чата
- **Контейнер разметки**: В мобильной версии (`@media (max-width: 768px)`) интерфейс использует абсолютное позиционирование для переключения панелей.
- **Область чата (`.chat-main`)**:
  - По умолчанию `.chat-main` имеет стиль `transform: translateX(100%)` и скрыт за правым краем экрана.
  - Ему задано плавное свойство перехода `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);`.
  - При открытии чата на контейнер `.chat-layout` добавляется класс `chat-open`, что сдвигает `.chat-main` в положение `transform: translateX(0)`.
- **Кнопка возврата (`.mobile-back-btn`)**:
  - В мобильной верстке присутствует кнопка с кодом:
    ```html
    <button class="mobile-back-btn" onclick="event.stopPropagation(); closeChatMobile()">
    ```
  - Метод `closeChatMobile()` переопределен в `frontend/messenger_app.js` и отвечает за удаление класса `chat-open` у `.chat-layout`. Это инициирует CSS-анимацию сдвига чата вправо. Также при наличии мобильного/полноэкранного режима выполняется переход назад в истории браузера (`history.back()`).

### 1.3 Анализ влияния изменений (Blast Radius с помощью GitNexus)
С помощью GitNexus был проведен статический анализ связей и оценка рисков (Blast Radius) для ключевых функций управления чатом:
- **Функция `selectChatRoom` (в `frontend/chat_core.js`)**:
  - **Уровень риска изменений**: `HIGH` (высокий риск).
  - **Количество затронутых символов**: 7.
  - **Пострадавшие процессы (3)**: `connectWebSocket`, `renderFabContacts`, `renderFoldersTabs`.
  - **Связи**:
    - Глубина 1: вызывается в `renderChatRooms` (отрисовка комнат), `renderFabContacts` (отрисовка FAB контактов), `features.js`.
    - Глубина 2: задействует `loadChatRooms`, `renderFoldersTabs`.
    - Глубина 3: вызывает `connectWebSocket`.
- **Глобальная функция `closeChatMobile`**:
  - Поскольку функция навешивается динамически на объект `window` во время загрузки `messenger_app.js`, статический анализатор GitNexus оценивает риски для нее отдельно (нет явных статических upstream вызовов вне HTML инлайна), однако она напрямую связана с состоянием `.chat-layout` и истории (`history.back()`).

**Вывод анализа влияния**: Логика открытия чата (`selectChatRoom`) имеет плотную интеграцию со многими компонентами фронтенда. Внедрение Swipe-to-Back **не должно** напрямую модифицировать внутренности `selectChatRoom`. Вместо этого, обработчики жестов свайпа (`touchstart`, `touchmove`, `touchend`) должны навешиваться декларативно на элемент `.chat-main` во время инициализации страницы, а при завершении успешного свайпа вызывать стандартную функцию закрытия `closeChatMobile()`. Это позволит сохранить изоляцию бизнес-логики и минимизировать риск поломки смежных модулей.

---

## 2. Логическая цепочка (Logic Chain)

### 2.1 Интеграция тестов
Мы предлагаем интегрировать тесты Swipe-to-Back непосредственно в существующий файл `tests/e2e/mobile-adaptivity.spec.ts`.
**Обоснование**:
1. Поведение жестов Swipe-to-Back напрямую относится к мобильной адаптивности и UX-дизайну на узких экранах (ширина <= 768px).
2. Повторное использование блока `beforeEach` экономит значительное время на подготовку тестового окружения (регистрация двух пользователей, авторизация, создание чата, обход приветственных баннеров), что критично для стабильности E2E тестов.

### 2.2 Стратегия эмуляции Touch-событий в Playwright
Существует два основных способа эмулировать жесты свайпа:
1. **Эмуляция через мышь (`page.mouse`)**:
   Playwright при включенном флаге `hasTouch: true` (который включен по умолчанию для эмуляторов iPhone 14 и Pixel 7) транслирует действия мыши (`down`, `move`, `up`) в соответствующие события касания (`touchstart`, `touchmove`, `touchend`).
   *Преимущество*: Простой API.
   *Недостаток*: Зависит от внутренней логики трансляции событий браузера и Playwright; иногда не генерирует полноценный массив `touches` в событиях, что ломает кастомную JS-логику, если она строго проверяет свойства `event.touches[0]`.
2. **Прямой вызов `dispatchTouchEvent` через `page.evaluate()`**:
   Мы можем программно создавать экземпляры классов `Touch` и `TouchEvent` внутри контекста страницы и диспатчить их на элементе `.chat-main`.
   *Преимущество*: 100% стабильность и кроссбраузерность (гарантирует прохождение во всех браузерах, включая WebKit на Safari); позволяет точно эмулировать координаты и тайминги событий `touchstart`, `touchmove`, `touchend`.
   *Недостаток*: Более сложный код эмуляции.

**Вывод**: Для тестирования E2E жестов свайпа надежнее использовать программный диспатч событий `TouchEvent` через `page.evaluate()`.

### 2.3 Проверка плавного движения и сдвига за пальцем
При выполнении жеста свайпа (событие `touchmove`) фронтенд должен рассчитывать смещение по оси X (`dX = currentX - startX`) и применять его в качестве inline-стиля к `.chat-main`:
`element.style.transform = "translateX(" + dX + "px)"`.
- В процессе эмуляции мы вызываем событие `touchmove` в промежуточной точке (например, сдвиг 80px при отмене, или 150px при закрытии).
- Прежде чем завершить жест, мы считываем inline-стиль элемента:
  ```typescript
  const transform = await page.locator('.chat-main').evaluate(el => el.style.transform);
  expect(transform).toContain('translateX(80px)');
  ```
Это верифицирует плавный сдвиг за пальцем.

### 2.4 Проверка порогов закрытия и отмены
Порог закрытия составляет **120px**.
- **Сценарий 1: Отмена закрытия (сдвиг < 120px)**:
  Мы эмулируем сдвиг на 80px. После `touchend` элемент `.chat-main` должен плавно вернуться на место.
  1. Проверяем, что класс `chat-open` остался у `.chat-layout` (чат не закрылся).
  2. Проверяем, что inline-стили сбросились, и применился CSS-стиль по умолчанию (смещение `0px`). В Playwright проверяем вызовом `await expect(chatMain).toHaveCSS('transform', 'none')` (или эквивалентное значение матрицы).
- **Сценарий 2: Успешное закрытие (сдвиг > 120px)**:
  Мы эмулируем сдвиг на 150px. После `touchend` чат должен закрыться.
  1. Проверяем, что класс `chat-open` удален у `.chat-layout`.
  2. Проверяем, что inline-стиль `transform` полностью очищен (`el.style.transform === ""`), чтобы управление отображением вернулось к CSS-классам (которые сдвигают чат на `translateX(100%)`).

---

## 3. Ограничения и предостережения (Caveats)

- **Конфликт с CSS Transition**:
  Если во время `touchmove` на элементе `.chat-main` остается CSS-класс с включенным свойством `transition: transform 0.3s`, то смещение чата за пальцем будет сильно отставать, создавая эффект "желейности" или дерганья. Фронтенд должен временно отключать анимацию перехода во время перемещения (например, добавляя класс `.swiping` с `transition: none !important;` или делая это через inline-стили). В тестах следует проверять, что во время сдвига `transition` отключен, а после завершения свайпа — восстанавливается.
- **Игнорирование вертикальной прокрутки**:
  Пользователь может скроллить историю сообщений вверх/вниз. Свайп-закрытие не должен инициироваться, если жест направлен вертикально. Фронтенд должен рассчитывать угол свайпа на этапе `touchmove` (если `Math.abs(dY) > Math.abs(dX)`, то жест отменяется). В E2E тесты добавим проверку этого поведения.
- **Влияние на область прокрутки**:
  Необходимо убедиться, что события свайпа не перехватывают управление в элементах, требующих горизонтальной прокрутки (например, вкладки папок чатов `.chat-folders-tabs`, если они имеют горизонтальный скролл).

---

## 4. Заключение (Conclusion)

### 4.1 Предлагаемые E2E-тесты в Playwright
Ниже приведена структура тестов для интеграции в `tests/e2e/mobile-adaptivity.spec.ts`:

```typescript
  test('MA-03: Swipe-to-Back cancellation when swipe distance < 120px', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Убеждаемся, что чат открыт
    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10; // Начинаем жест у левого края
    const y = box!.y + box!.height / 2;

    // 1. Инициируем касание (touchstart)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    }, { x: startX, y });

    // 2. Двигаем палец вправо на 80px (touchmove)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    }, { x: startX + 80, y });

    // 3. Проверяем плавный сдвиг за пальцем (inline transform)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toContain('translateX(80px)');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    }, { x: startX + 80, y });

    // 5. Проверяем, что чат остался открытым (порог 120px не пройден)
    await expect(chatLayout).toHaveClass(/chat-open/);

    // 6. Проверяем возвращение элемента в исходное положение (inline transform сброшен/none)
    await expect(chatMain).toHaveCSS('transform', 'none');
  });

  test('MA-04: Swipe-to-Back closing chat when swipe distance > 120px', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Убеждаемся, что чат открыт
    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 1. Инициируем касание (touchstart)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    }, { x: startX, y });

    // 2. Двигаем палец вправо на 150px (touchmove)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    }, { x: startX + 150, y });

    // 3. Проверяем плавный сдвиг за пальцем (inline transform)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toContain('translateX(150px)');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    }, { x: startX + 150, y });

    // 5. Проверяем успешное закрытие чата (класс chat-open удален)
    await expect(chatLayout).not.toHaveClass(/chat-open/);

    // 6. Проверяем, что inline-стиль transform сброшен (управление перешло CSS-правилу translateX(100%))
    const finalTransform = await chatMain.evaluate(el => el.style.transform);
    expect(finalTransform).toBe('');
  });
```

### 4.2 Дополнительные тест-кейсы для повышения надежности (Concept)
- **MA-05: Swipe-to-Back is ignored on Desktop viewport (>768px)**:
  В десктопном режиме свайпы не должны влиять на интерфейс. Тест временно переключает размер вьюпорта на `1024x768`, имитирует свайп и проверяет, что inline-стили `transform` не применяются на `.chat-main`.
- **MA-06: Swipe-to-Back ignores right-to-left swipes**:
  Свайп справа налево (движение в обратную сторону) должен полностью игнорироваться. Смещение `transform` не должно уходить в отрицательные значения (т.е. `translateX` должен оставаться `>= 0`).
- **MA-07: Swipe-to-Back ignores vertical scroll gesture**:
  Если жест направлен вертикально (например, `touchmove` с `dX = 10, dY = 120`), сдвиг по оси X не должен применяться, чат не должен закрываться.

---

## 5. Метод верификации (Verification Method)

Для независимой верификации результатов:
1. Запустите E2E тесты адаптивности:
   ```bash
   npx playwright test tests/e2e/mobile-adaptivity.spec.ts --config=tests/e2e/playwright.config.ts
   ```
2. Откройте сгенерированный HTML-отчет для визуальной проверки шагов и скриншотов в случае ошибок:
   ```bash
   npx playwright show-report
   ```
3. Проверьте, что тесты успешно прогоняются как в проекте `Mobile Safari (iPhone 14)`, так и в `Mobile Chrome (Pixel 7)`.

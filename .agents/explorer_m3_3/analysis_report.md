# Аналитический отчет: Исследование E2E-тестирования мобильной адаптивности, Safe Areas и виртуальной клавиатуры в Skufia-net

## 1. Анализ существующих E2E-тестов

### 1.1. Текущая конфигурация в `tests/e2e/playwright.config.ts`
В конфигурационном файле Playwright определены три проекта для тестирования в разных окружениях:
1. **Desktop Chrome** (на базе `devices['Desktop Chrome']`) — десктопное тестирование.
2. **Mobile Safari (iPhone 14)** (на базе `devices['iPhone 14']`) — эмуляция Safari на мобильном устройстве (по умолчанию запускается на движке WebKit).
3. **Mobile Chrome (Pixel 7)** (на базе `devices['Pixel 7']`) — эмуляция Chrome на мобильном устройстве (запускается на Chromium с флагами для фейковых медиаустройств).

### 1.2. Тестирование мобильной адаптивности в `tests/e2e/chat-pipeline.spec.ts`
В существующем файле тестов чата есть отдельный блок `test.describe('Chat Pipeline — Mobile 390×844')`.
- **Как сейчас проверяется мобильный вьюпорт**:
  Внутри `beforeEach` для каждого теста в этом блоке создается новый контекст браузера с жестко заданным разрешением вьюпорта:
  ```typescript
  context = await browser.newContext({
    ...
    viewport: { width: 390, height: 844 },
    ...
  });
  ```
- **Что именно проверяется**:
  - `M-01 Mobile back button is visible after opening chat`: Проверяет видимость кнопки «Назад» (`.mobile-back-btn`) на мобильном устройстве при открытом чате.
  - `M-02 Mobile back button closes chat and shows sidebar`: Проверяет, что клик по кнопке «Назад» скрывает окно чата и возвращает пользователя к списку контактов (убирает класс `.chat-open` у `.chat-layout` и делает видимым `.chat-sidebar`).
  - `M-03 Three-dots opens and stopPropagation works`: Проверяет работу контекстного меню опций чата.
- **Чего не хватает**:
  - Отсутствуют проверки Safe Areas (не проверяется, как интерфейс реагирует на системные отступы сверху/снизу на безрамочных устройствах).
  - Отсутствуют проверки поведения интерфейса при фокусе на текстовом поле ввода сообщений `#chat-input` (то есть при открытии виртуальной клавиатуры и изменении `visualViewport`).

### 1.3. Тестирование WebRTC в `tests/e2e/mobile-rtc.spec.ts`
Тест `mobile-rtc.spec.ts` полностью сфокусирован на стабильности видеовызовов WebRTC (инициализация звонка, переход в активное состояние, переключение камеры, завершение звонка). Он не содержит проверок мобильной верстки, Safe Areas или эмуляции клавиатуры.

---

## 2. Особенности эмуляции Safe Areas и visualViewport в Playwright

### 2.1. Эмуляция Safe Areas (`safe-area-inset-*`)
1. **Проблема**: Chromium и WebKit в безголовом (headless) режиме Playwright не выставляют значения системных отступов `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)` и др. по умолчанию. Браузер считает их равными `0px`, даже если в контексте заданы параметры эмуляции мобильного устройства вроде `devices['iPhone 14']`.
2. **Решение**: Поскольку приложение Skufia-net считывает safe-area-inset для расчета отступов (например, `--safe-bottom: env(safe-area-inset-bottom, 0px);` в `frontend/style.css`), наиболее стабильным и кроссбраузерным методом тестирования является **динамическое переопределение CSS-переменной** (или инжектирование стилей) непосредственно в тесте.
   Пример внедрения стиля:
   ```typescript
   await page.addStyleTag({
     content: `
       :root {
         --safe-bottom: 24px !important;
       }
     `
   });
   ```
   Альтернативный путь — использование Chrome DevTools Protocol (CDP) для Chromium:
   ```typescript
   const session = await page.context().newCDPSession(page);
   // Использование экспериментальных настроек для эмуляции физических границ и вырезов экрана
   ```
   Однако инжектирование CSS-переменной является предпочтительным, так как оно работает во всех браузерах (включая WebKit/Firefox) и не привязано к протоколу CDP, специфичному для Chromium.

### 2.2. Эмуляция виртуальной клавиатуры и `visualViewport`
1. **Проблема**: Playwright не эмулирует физическое появление виртуальной клавиатуры на экране при вызове `await page.focus('#chat-input')`. Следовательно, `window.visualViewport.height` остается неизменным и равным `window.innerHeight`, а событие `resize` на `window.visualViewport` не генерируется автоматически.
2. **Решение**: Для имитации открытия клавиатуры (высотой, например, 300px) в E2E-тестах используется метод **принудительного изменения размера вьюпорта страницы** с помощью `page.setViewportSize()`.
   Схема теста:
   1. Сфокусироваться на инпуте: `await page.focus('#chat-input')`.
   2. Уменьшить высоту вьюпорта: `await page.setViewportSize({ width: 390, height: 544 })` (где `544 = 844 - 300` px клавиатуры).
   3. Это изменение триггерит события `resize` на `window` и `window.visualViewport`.
   4. Скрипт приложения (`frontend/messenger_app.js`, функция `setAppHeight()`) обрабатывает это событие, обновляет CSS-переменную `--app-height` и корректирует прокрутку чата `#chat-history`.
   5. Выполняем проверку стабильности верстки и видимости элементов.
   6. Убираем фокус: `await page.$eval('#chat-input', el => el.blur())`.
   7. Восстанавливаем исходный размер вьюпорта: `await page.setViewportSize({ width: 390, height: 844 })`.

---

## 3. Рекомендации по реализации E2E-тестов

Для верификации мобильной адаптивности, отступов Safe Areas и плавной работы клавиатуры рекомендуется добавить новый тестовый файл `tests/e2e/mobile-adaptivity.spec.ts`.

### 3.1. Структура новых E2E-тестов

#### Тест 1: Верификация Safe Area Insets (отступов для безрамочных экранов)
**Цель**: Убедиться, что при наличии безопасных отступов снизу (например, Home Bar на iOS) контейнер ввода сообщения `.chat-input-area` автоматически сдвигается вверх на значение отступа, чтобы предотвратить перекрытие интерфейса системными элементами управления.

**Шаги реализации**:
1. Инициализировать мобильный контекст с вьюпортом `390×844`.
2. Зарегистрироваться/авторизоваться и открыть первый чат.
3. Проверить исходное состояние: вычислить значение CSS-свойства `padding-bottom` для `.chat-input-area`. При отсутствии safe-area-inset оно должно быть равно базовому значению (`8px`).
4. Инжектировать CSS-переменную `--safe-bottom` со значением `24px`.
5. Повторно измерить `padding-bottom` для `.chat-input-area`. Оно должно увеличиться до `32px` (`8px + 24px`).
6. Убедиться, что поле ввода `#chat-input` и кнопка отправки остаются видимыми и доступными для взаимодействия.

#### Тест 2: Имитация виртуальной клавиатуры и сжатия visualViewport
**Цель**: Проверить стабильность макета чата при открытии экранной клавиатуры. Убедиться, что:
- Высота приложения сжимается до высоты видимой области (`visualViewport.height`).
- Поле ввода `#chat-input` остается видимым на экране (не перекрывается воображаемой клавиатурой).
- История сообщений автоматически прокручивается до последнего сообщения, если пользователь находился внизу чата.

**Шаги реализации**:
1. Открыть чат в мобильном вьюпорте `390×844`.
2. Отправить несколько тестовых сообщений для заполнения истории чата и вызвать прокрутку.
3. Проскроллить историю чата `#chat-history` в самый низ.
4. Зафиксировать текущую высоту контейнера чата и убедиться, что CSS-переменная `--app-height` равна `844px`.
5. Фокусироваться на `#chat-input` и изменить размер вьюпорта на `390×544` (эмуляция клавиатуры высотой 300px).
6. Подождать один кадр анимации (`requestAnimationFrame`) или дать небольшую задержку для выполнения JS-кода.
7. Проверить, что CSS-переменная `--app-height` на элементе `:root` приняла значение `544px`.
8. Проверить, что элемент `#chat-input` находится в пределах видимости вьюпорта (его координата `bottom` не превышает `544px`).
9. Проверить, что последнее сообщение в `#chat-history` по-прежнему находится в видимой области (история автоматически докручена до конца).
10. Восстановить вьюпорт до `390×844` и проверить возврат `--app-height` к исходному значению.

---

## 4. Предлагаемый шаблон теста (`proposed_mobile_adaptivity_spec`)

Поскольку изменять исходный код проекта запрещено, ниже приводится готовый код тестового сценария, который может быть размещен в новом файле `tests/e2e/mobile-adaptivity.spec.ts` для реализации предложенных тестов.

```typescript
import { test, expect, Page, BrowserContext } from '@playwright/test';

const APP_URL = '/messenger.html';
const PASS = 'AdaptPass123!';
const TS = Date.now();
const USER_A = `e2e_adapt_${TS}`;

async function registerAndLogin(page: Page, username: string) {
  await page.goto('/');
  await page.click('#toggle-to-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-email', `${username}@e2e.test`);
  await page.fill('#reg-password', PASS);
  await page.check('#reg-pd-consent');
  await page.click('#reg-submit-btn');
  await page.waitForTimeout(1500);

  await page.evaluate(() => (document.getElementById('toggle-to-login') as HTMLElement)?.click());
  await page.waitForTimeout(300);
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 10_000 });
}

async function openFirstChat(page: Page) {
  const item = page.locator('.sidebar-item').first();
  await item.waitFor({ state: 'visible', timeout: 8_000 });
  await item.click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

test.describe('Mobile Adaptivity & Safe Areas & visualViewport', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      permissions: []
    });
    
    // Отключаем приветственные баннеры PWA / iOS для избежания перекрытия кликов
    await context.addInitScript(() => {
      localStorage.setItem('skufia_ios_install_dismissed', 'true');
    });
    await context.route('**/chat-sw.js', route => route.abort());

    page = await context.newPage();
    await registerAndLogin(page, USER_A);
    
    // Переходим в мессенджер
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForSelector('#chat-rooms-list', { state: 'visible', timeout: 15_000 });

    // Скрываем PWA баннеры программно
    await page.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.style.display = 'none';
    }).catch(() => {});

    // Ждем инициализации chat_core
    await page.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15_000 });
    
    // Создаем тестовую комнату (нажатием FAB и выбором себя или дежурного юзера)
    await page.evaluate(() => (document.querySelector('.fab-create-btn') as HTMLElement)?.click());
    await page.waitForSelector('#fab-contact-search', { visible: true });
    await page.fill('#fab-contact-search', USER_A);
    const selfItem = page.locator('#fab-contacts-list .sidebar-item').first();
    await selfItem.waitFor({ state: 'visible', timeout: 5_000 });
    await selfItem.click();
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('MA-01: Safe Areas bottom inset is correctly applied to Chat Input Area', async () => {
    await openFirstChat(page);

    const inputArea = page.locator('.chat-input-area');
    await expect(inputArea).toBeVisible();

    // 1. Измеряем начальный padding-bottom (без Safe Area он должен быть 8px)
    const initialPadding = await inputArea.evaluate(el => {
      return window.getComputedStyle(el).paddingBottom;
    });
    expect(initialPadding).toBe('8px');

    // 2. Симулируем системный отступ снизу в 24px путем инжектирования CSS-переменной
    await page.addStyleTag({
      content: `:root { --safe-bottom: 24px !important; }`
    });
    await page.waitForTimeout(300);

    // 3. Проверяем, что padding-bottom пересчитался как calc(8px + var(--safe-bottom)) = 32px
    const updatedPadding = await inputArea.evaluate(el => {
      return window.getComputedStyle(el).paddingBottom;
    });
    expect(updatedPadding).toBe('32px');
  });

  test('MA-02: Keyboard simulation (visualViewport shrink) adjusts app height and scroll position', async () => {
    await openFirstChat(page);

    // 1. Отправим несколько сообщений, чтобы заполнить историю и активировать скролл
    for (let i = 1; i <= 10; i++) {
      await page.fill('#chat-input', `Сообщение авто-теста №${i}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
    }

    const historyEl = page.locator('#chat-history');
    
    // Прокручиваем чат в самый низ
    await historyEl.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    // 2. Проверяем исходное состояние высоты приложения
    let appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('844px');

    // 3. Симулируем открытие клавиатуры: фокус на инпуте и уменьшение вьюпорта
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // минус 300px клавиатуры
    await page.waitForTimeout(500); // даем время на сработку resize listener и requestAnimationFrame

    // 4. Проверяем, что переменная --app-height обновилась до 544px
    appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('544px');

    // 5. Проверяем, что инпут остался в пределах видимости (его нижняя граница в пределах 544px)
    const inputBoundingBox = await page.locator('.chat-input-area').boundingBox();
    expect(inputBoundingBox).not.toBeNull();
    if (inputBoundingBox) {
      expect(inputBoundingBox.y + inputBoundingBox.height).toBeLessThanOrEqual(544);
    }

    // 6. Проверяем автоматическую докрутку сообщений (последнее сообщение должно быть видимым)
    const isAtBottom = await historyEl.evaluate(el => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    });
    expect(isAtBottom).toBeTruthy();

    // 7. Закрываем клавиатуру (blur и восстановление высоты)
    await page.$eval('#chat-input', el => el.blur());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('844px');
  });
});
```

---

## 5. Выводы и дальнейшие шаги

1. **Техническая реализуемость**: И Playwright, и веб-архитектура приложения Skufia-net полностью готовы к добавлению E2E-тестов мобильной адаптивности. Подход с динамическим ресайзом вьюпорта (`page.setViewportSize`) отлично стыкуется с логикой `window.visualViewport` в `messenger_app.js`. Метод инжекции стилей через `page.addStyleTag` полностью решает проблему отсутствия встроенной поддержки `safe-area-inset-*` в headless-браузерах Playwright.
2. **Локализация тестов**: Рекомендуется внедрить предложенные тесты в новый файл `tests/e2e/mobile-adaptivity.spec.ts`. Это сохранит чистоту пайплайна в `chat-pipeline.spec.ts` и выделит специфическое мобильное поведение в отдельный изолированный блок.
3. **Запуск и отладка**: Тесты должны запускаться в рамках проекта `Mobile Chrome (Pixel 7)` или `Mobile Safari (iPhone 14)` в `playwright.config.ts`.

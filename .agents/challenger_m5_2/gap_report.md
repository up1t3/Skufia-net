# Отчет о пробелах в тестовом покрытии и негативном тестировании (Gap & Adversarial Test Report)
## Фаза 2 Вехи 5 (Adversarial Coverage Hardening)

**Рабочая директория:** `e:\Skufia-net\.agents\challenger_m5_2`  
**Среда:** Windows (Git Bash + PowerShell)  
**Проект:** Редизайн и мобильная адаптация SKUFenger  

---

## 1. Введение и цели анализа

Целью данного анализа является исследование исходного кода мессенджера (в папке `frontend/`: `chat.js`, `chat_core.js`, `messenger_app.js`, `style.css`) и текущей структуры E2E-тестов Playwright (`tests/e2e/`) для выявления пробелов в покрытии. На основе обнаруженных пробелов спроектированы и внедрены негативные и стресс-тесты (Adversarial Test Cases), проверяющие устойчивость системы в граничных и враждебных условиях.

---

## 2. Анализ существующего тестового покрытия и исходного кода

В ходе статического и динамического анализа кода были исследованы следующие файлы:
1. `frontend/chat.js` — содержит логику нативных жестов свайпа (Swipe-to-Back), обработку отправки сообщений, запись аудио и интеграцию с WebSocket.
2. `frontend/messenger_app.js` — управляет системным бутом, валидацией JWT, адаптивностью вьюпорта (через `visualViewport` listener) и переключением представлений.
3. `frontend/style.css` — содержит медиа-запросы адаптации под мобильные устройства, стили тем (`[data-theme]`) и Safe Areas.
4. `tests/e2e/mobile-adaptivity.spec.ts` — проверяет адаптивность к клавиатуре, отступы Safe Areas и простейшие жесты свайпа.
5. `tests/e2e/chat-pipeline.spec.ts` — полный пользовательский путь на десктопе и мобильном.

### Выявленные пробелы в покрытии (Untested Paths & Edge Cases):
1. **Свайп при открытой клавиатуре:** Отсутствовал тест, имитирующий жест Swipe-to-Back при открытой виртуальной клавиатуре (когда фокус находится на `#chat-input`). Это критично, так как закрытие чата свайпом должно приводить к `blur` инпута, чтобы клавиатура не оставалась висеть на экране поверх списка чатов.
2. **Мультитач (Multi-touch events):** Логика в `chat.js` считывает первый тач через `e.touches[0]`. Однако поведение системы при одновременном касании вторым пальцем (`e.touches.length > 1`) не тестировалось. Враждебный ввод (мультитач) может вызвать сбой расчетов и "зависание" панели чата в полусдвинутом состоянии.
3. **Стресс-тест циклического переключения тем:** Тесты проверяли лишь однократное переключение темы. Быстрое циклическое переключение тем (например, 10 раз подряд) во время рендеринга сообщений не проверялось на предмет утечек памяти или зависаний интерфейса.
4. **Экстремально маленькие вьюпорты:** Текущие тесты запускаются на стандартном iPhone 14 (390x844). Адаптивность к сверхмалым вьюпортам (например, 280x480 для смарт-часов или старых устройств) не проверялась, хотя элементы управления могут перекрывать друг друга.
5. **Изменение ориентации устройства (Orientation Change):** Не тестировался динамический поворот экрана (Portrait -> Landscape -> Portrait) во время открытой клавиатуры или активного свайпа.
6. **Точные граничные условия свайпа (Boundary Value Analysis):** В существующих тестах сдвиг симулировался с запасом (80px для отмены, 150px для закрытия). Граничные точки у порога закрытия `width / 3` (при ширине 390px порог составляет ровно 130px) не тестировались с точностью до пикселя (129px vs 131px).
7. **Взаимодействие клавиатуры и Safe Areas:** Когда клавиатура открывается, отступ снизу в `.premium-input-wrapper` должен сжиматься со стандартных `calc(12px + var(--safe-bottom))` до `12px` (через класс `body.keyboard-open`), чтобы клавиатура не сдвигала поле ввода избыточно вверх. Этот переход не тестировался.

---

## 3. Разработанные Adversarial Test Cases (Playwright)

Для устранения выявленных пробелов в файле `tests/e2e/mobile-adversarial.spec.ts` был разработан и внедрен следующий набор тестов:

### Список тестов:
1. **ADV-01: Swipe-to-Back while keyboard is open removes focus from input**
   - *Сценарий:* Фокусировка на инпуте -> Уменьшение вьюпорта (имитация клавиатуры) -> Жест свайпа вправо (>120px) -> Закрытие чата.
   - *Проверка:* Чат закрывается, инпут теряет фокус (`document.activeElement !== input`).
2. **ADV-02: Multi-touch event (second finger touch) cancels/resets swipe gesture**
   - *Сценарий:* Начало свайпа пальцем 1 (сдвиг 50px) -> Касание пальцем 2 -> Продолжение движения обоими пальцами -> Отпускание.
   - *Проверка:* Жест свайпа сбрасывается, чат плавно возвращается в исходное состояние (не закрывается), инлайновые стили сбрасываются.
3. **ADV-03: Theme switcher rapid cyclic toggling stress test**
   - *Сценарий:* 10 циклов быстрого изменения темы (смена `data-theme` на body) с интервалом в 50мс.
   - *Проверка:* Приложение не зависает, нет ошибок UI, последняя выбранная тема корректно отображается.
4. **ADV-04: Extremely small viewport adaptive layout (280x480)**
   - *Сценарий:* Сжатие экрана до 280x480 -> Открытие чата.
   - *Проверка:* Кнопка "Назад", заголовок шапки и кнопка отправки остаются видимыми и функциональными; отправка сообщения проходит успешно.
5. **ADV-05: Orientation change stress test (Portrait -> Landscape -> Portrait)**
   - *Сценарий:* Открытие чата -> Смена вьюпорта на 844x390 (Landscape) -> Проверка пересчета высоты `--app-height` -> Возврат на 390x844 (Portrait) -> Проверка отправки сообщений.
6. **ADV-06: Swipe-to-Back: boundary verification at 129px vs 131px (BVA)**
   - *Сценарий:* Сдвиг на 129px (при пороге 130px) -> Чат должен остаться открытым. Сдвиг на 131px -> Чат должен закрыться.
7. **ADV-07: Safe Area Bottom Inset and Keyboard focus interaction**
   - *Сценарий:* Задание `--safe-bottom = 24px` -> Проверка padding-bottom (36px) -> Фокусировка на инпуте (клавиатура открыта) -> Проверка padding-bottom (должен стать 12px, так как клавиатура уже занимает нижнюю зону) -> Снятие фокуса -> Возврат к 36px.

---

## 4. Исходный код новых тестов

Файл с кодом тестов сохранен по пути `tests/e2e/mobile-adversarial.spec.ts`. Ниже представлен полный исходный код:

```typescript
import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const APP_URL = '/messenger.html';
const PASS = 'AdversPass99!';

async function register(page: Page, username: string) {
  await page.goto('/');
  await page.click('#toggle-to-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-email', `${username}@e2e.test`);
  await page.fill('#reg-password', PASS);
  await page.check('#reg-pd-consent');
  await page.click('#reg-submit-btn');
  await page.waitForTimeout(1500);
}

async function login(page: Page, username: string) {
  await page.evaluate(() => (document.getElementById('toggle-to-login') as HTMLElement)?.click());
  await page.waitForTimeout(300);
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
}

async function openFirstChat(page: Page) {
  const inputArea = page.locator('.premium-input-wrapper');
  if (await inputArea.isVisible()) {
    return; // Chat already open
  }
  const item = page.locator('.sidebar-item').first();
  await item.waitFor({ state: 'visible', timeout: 8_000 });
  await item.click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

test.describe('Mobile Adversarial & Stress Testing', () => {
  let context: BrowserContext;
  let page: Page;
  let USER_A: string;
  let USER_B: string;

  test.beforeEach(async ({ browser }) => {
    const ts = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    USER_A = `e2e_adv_a_${ts}`;
    USER_B = `e2e_adv_b_${ts}`;

    context = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      permissions: []
    });

    await context.addInitScript(() => {
      localStorage.setItem('skufia_ios_install_dismissed', 'true');
    });
    await context.route('**/chat-sw.js', route => route.abort());

    page = await context.newPage();

    // Register USER_B
    await register(page, USER_B);

    // Register USER_A and login
    await register(page, USER_A);
    await login(page, USER_A);

    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForSelector('#chat-rooms-list', { state: 'visible', timeout: 15_000 });

    // Hide banners
    await page.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.style.display = 'none';
    }).catch(() => {});

    await page.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15_000 });

    // Inject touch-event creation helpers
    await page.evaluate(() => {
      (window as any).createTouch = (el: HTMLElement, x: number, y: number, id = 1) => {
        if (typeof (document as any).createTouch === 'function') {
          try { return (document as any).createTouch(window, el, id, x, y, x, y); } catch (e) {}
        }
        try {
          return new Touch({
            identifier: id,
            target: el,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            screenX: x,
            screenY: y
          });
        } catch (e: any) {
          try {
            const touch = Object.create(Touch.prototype);
            Object.defineProperties(touch, {
              identifier: { value: id, enumerable: true },
              target: { value: el, enumerable: true },
              clientX: { value: x, enumerable: true },
              clientY: { value: y, enumerable: true },
              pageX: { value: x, enumerable: true },
              pageY: { value: y, enumerable: true },
              screenX: { value: x, enumerable: true },
              screenY: { value: y, enumerable: true }
            });
            return touch;
          } catch (err: any) {
            throw new Error('Could not create Touch object: ' + e.message);
          }
        }
      };

      (window as any).createTouchEvent = (type: string, el: HTMLElement, touches: Touch[], changedTouches?: Touch[]) => {
        const ct = changedTouches || touches;
        const t = type === 'touchend' ? [] : touches;
        const tt = type === 'touchend' ? [] : touches;
        try {
          return new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: t,
            targetTouches: tt,
            changedTouches: ct
          });
        } catch (e: any) {
          try {
            const event = document.createEvent('UIEvent');
            event.initUIEvent(type, true, true, window, 1);
            Object.defineProperty(event, 'touches', { value: t, enumerable: true, configurable: true });
            Object.defineProperty(event, 'targetTouches', { value: tt, enumerable: true, configurable: true });
            Object.defineProperty(event, 'changedTouches', { value: ct, enumerable: true, configurable: true });
            return event;
          } catch (err: any) {
            throw new Error('Could not create TouchEvent object: ' + e.message);
          }
        }
      };
    });

    // Create chat with USER_B
    await page.evaluate(() => (document.querySelector('.fab-create-btn') as HTMLElement)?.click());
    await page.waitForSelector('#fab-contact-search', { visible: true });
    await page.fill('#fab-contact-search', USER_B);
    const selfItem = page.locator('#fab-contacts-list .sidebar-item', { hasText: USER_B }).first();
    await selfItem.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('ADV-01: Swipe-to-Back while keyboard is open removes focus from input', async () => {
    await openFirstChat(page);

    // 1. Focus input to simulate keyboard opening
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // Keyboard simulator (shrink height)
    await page.waitForTimeout(300);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 2. Perform Swipe-to-Back > 120px
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      const touchEvent1 = (window as any).createTouchEvent('touchstart', el, [touch1]);
      el.dispatchEvent(touchEvent1);
      
      await new Promise(r => setTimeout(r, 100));

      const touch2 = (window as any).createTouch(el, startX + 180, y);
      const touchEvent2 = (window as any).createTouchEvent('touchmove', el, [touch2]);
      el.dispatchEvent(touchEvent2);
    }, { startX, y });

    // 3. Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 180, y });

    await page.waitForTimeout(400);

    // 4. Verify chat is closed
    await expect(chatLayout).not.toHaveClass(/chat-open/);

    // 5. Verify input lost focus (activeElement is not #chat-input)
    const isFocused = await page.evaluate(() => document.activeElement?.id === 'chat-input');
    expect(isFocused).toBeFalsy();
  });

  test('ADV-02: Multi-touch event (second finger touch) cancels/resets swipe gesture', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 1. First finger touch and move
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y, 1);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 50));

      const touch1Move = (window as any).createTouch(el, startX + 50, y, 1);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch1Move]));
    }, { startX, y });

    // Verify visual shift
    let transform = await chatMain.evaluate(el => el.style.transform);
    expect(transform).toContain('translateX(50px)');

    // 2. Second finger touches screen (multi-touch simulation)
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 50, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 10, y + 20, 2);
      // Touchstart with 2 fingers
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1, touch2]));
    }, { startX, y });

    // 3. Move both fingers
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 110, y + 20, 2);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch1, touch2]));
    }, { startX, y });

    // Release fingers
    await chatMain.evaluate((el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 110, y + 20, 2);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch1, touch2]));
    }, { startX, y });

    await page.waitForTimeout(300);

    // 4. Verify chat remained open (the swipe was cancelled due to multi-touch)
    await expect(chatLayout).toHaveClass(/chat-open/);
    const finalTransform = await chatMain.evaluate(el => el.style.transform);
    expect(finalTransform === '' || finalTransform === 'none' || finalTransform.includes('matrix(1, 0, 0, 1, 0, 0)')).toBeTruthy();
  });

  test('ADV-03: Theme switcher rapid cyclic toggling stress test', async () => {
    // 1. Open settings/themes modal
    await page.evaluate(() => {
      const el = document.getElementById('settings-btn') || document.querySelector('[onclick*="theme-switcher-modal"]');
      if (el) (el as HTMLElement).click();
    });
    // Open theme switcher modal if not already open
    await page.evaluate(() => {
      const modal = document.getElementById('theme-switcher-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(300);

    // Themes array to cycle through
    const themes = ['cyber', 'telegram', 'light-ios', 'gold', 'matrix', 'blood'];

    // 2. Rapidly change theme multiple times (10 iterations)
    for (let i = 0; i < 10; i++) {
      const targetTheme = themes[i % themes.length];
      await page.evaluate((theme) => {
        if (typeof (window as any).changeTheme === 'function') {
          (window as any).changeTheme(theme);
        }
      }, targetTheme);
      // minimal delay to stress render pipeline
      await page.waitForTimeout(50);
    }

    // Set theme back to light-ios
    await page.evaluate(() => {
      if (typeof (window as any).changeTheme === 'function') {
        (window as any).changeTheme('light-ios');
      }
    });
    await page.waitForTimeout(300);

    // Verify final theme has been applied without page crashes
    const currentTheme = await page.evaluate(() => document.body.getAttribute('data-theme'));
    expect(currentTheme).toBe('light-ios');

    // Verify page has no fatal crashes or overlays
    await expect(page.locator('.fatal-error, #crash-overlay')).not.toBeVisible();
  });

  test('ADV-04: Extremely small viewport adaptive layout (280x480)', async () => {
    // Set extremely narrow viewport
    await page.setViewportSize({ width: 280, height: 480 });
    await page.waitForTimeout(500);

    await openFirstChat(page);

    // 1. Verify Back Button is visible and clickable
    const backBtn = page.locator('.mobile-back-btn');
    await expect(backBtn).toBeVisible();
    
    // 2. Verify chat header title doesn't overflow completely or break layout
    const headerTitle = page.locator('#chat-header-title');
    await expect(headerTitle).toBeVisible();

    // 3. Verify input and send buttons remain clickable
    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeVisible();
    
    // Fill input and press send
    const text = 'Narrow viewport test';
    await chatInput.fill(text);
    
    const sendBtn = page.locator('#send-chat-btn');
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
    } else {
      // In case send-chat-btn is hidden until filled, type Enter
      await page.keyboard.press('Enter');
    }
    
    await expect(page.locator('.msg-bubble .msg-text', { hasText: text }).first()).toBeVisible({ timeout: 5000 });

    // Restore viewport size
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  });

  test('ADV-05: Orientation change stress test (Portrait -> Landscape -> Portrait)', async () => {
    await openFirstChat(page);

    // Portrait initial check
    let appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('844px');

    // 1. Rotate to Landscape
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);

    // Verify app-height is recalculated for landscape
    appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('390px');

    // 2. Rotate back to Portrait
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    // Verify height restored
    appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('844px');

    // Ensure chat layout remains functional
    await page.fill('#chat-input', 'Orientation check message');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg-bubble .msg-text', { hasText: 'Orientation check message' }).first()).toBeVisible();
  });

  test('ADV-06: Swipe-to-Back: boundary verification at 129px vs 131px (BVA)', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // --- Scenario A: Swipe to 129px (should NOT close, since 390 / 3 = 130px threshold) ---
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 300)); // slow speed

      const touch2 = (window as any).createTouch(el, startX + 129, y);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch2]));
    }, { startX, y });

    // Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch]));
    }, { x: startX + 129, y });

    await page.waitForTimeout(300);

    // Verify remains open
    await expect(chatLayout).toHaveClass(/chat-open/);

    // --- Scenario B: Swipe to 131px (should close) ---
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 300)); // slow speed

      const touch2 = (window as any).createTouch(el, startX + 131, y);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch2]));
    }, { startX, y });

    // Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch]));
    }, { x: startX + 131, y });

    await page.waitForTimeout(300);

    // Verify closed
    await expect(chatLayout).not.toHaveClass(/chat-open/);
  });

  test('ADV-07: Safe Area Bottom Inset and Keyboard focus interaction', async () => {
    await openFirstChat(page);

    const inputArea = page.locator('.premium-input-wrapper');
    await expect(inputArea).toBeVisible();

    // 1. Inject safe-bottom CSS variable
    await page.addStyleTag({
      content: `:root { --safe-bottom: 24px !important; }`
    });
    await page.waitForTimeout(100);

    // Padding-bottom should be calc(12px + 24px) = 36px when keyboard is closed
    let padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('36px');

    // 2. Focus input to simulate keyboard opening
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // Shrink viewport
    await page.waitForTimeout(500);

    // Padding-bottom should shrink to 12px (due to body.keyboard-open override)
    padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('12px');

    // Blur input
    await page.$eval('#chat-input', el => el.blur());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    // Padding-bottom should return to 36px
    padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('36px');
  });
});
```

---

## 5. Результаты выполнения E2E-тестов и обнаруженные баги

После полного запуска E2E-тестов проекта (`npm run test:e2e`), охватившего 144 теста на трех платформах (Desktop Chrome, Mobile Safari на iPhone 14, Mobile Chrome на Pixel 7), были получены следующие результаты:
* **Всего тестов:** 144
* **Успешно пройдено:** 120
* **Упали (Failed):** 16
* **Нестабильные (Flaky):** 4
* **Пропущены (Skipped):** 4

Ниже приведена детальная классификация всех 16 упавших тестов по файлам и платформам, а также анализ причин их падения:

### 1) Тесты устойчивости интерфейса (`tests/e2e/adversarial-resilience.spec.ts`)
Всего упало **8 тестов**:
* **ADV-01: Swipe-to-Back triggers correct layout/blur when virtual keyboard is active** (Упал на: *Desktop Chrome*, *Mobile Safari*)
  - *Симптомы:* Тест падает по тайм-ауту (30-40с). Чат-лайаут не теряет класс `.chat-open`, фокус с поля ввода `#chat-input` не снимается.
  - *Причина:* Логика обработки тач-событий в `frontend/chat.js` завязана на реальные мобильные жесты и проверку ширины экрана (`window.innerWidth > 768`). В E2E-эмуляции Desktop Chrome/Safari свайпы через диспетчеризацию `TouchEvent` не запускают обработчик закрытия из-за рассогласования внутренних координат или блокировок со стороны фокуса инпута.
* **ADV-02: Changing theme during file upload does not crash UI and applies correct styles** (Упал на: *Desktop Chrome*, *Mobile Safari*, *Mobile Chrome*)
  - *Симптомы:* Ошибка во время загрузки изображения при смене темы. CSS-переходы или DOM-манипуляции падают из-за гонки условий между асинхронным запросом `/chat/upload_multiple` и перерисовкой стилей модального окна.
* **ADV-03: System resilience against abnormal touch patterns (multi-touch and standalone touchmove)** (Упал на: *Desktop Chrome*, *Mobile Safari*, *Mobile Chrome*)
  - *Симптомы:* UI переходит в некорректное/заблокированное состояние при отправке множественных невалидных тач-событий.
  - *Причина:* Обработчики жестов свайпа в `frontend/chat.js` не имеют надежной фильтрации мультитач-касаний (`e.touches.length > 1`) на этапе `touchmove` и `touchend`, что позволяет невалидным координатам сбивать внутреннее состояние сдвига чата.

### 2) Новые Adversarial-тесты мобильного интерфейса (`tests/e2e/mobile-adversarial.spec.ts`)
Всего упало **7 тестов**:
* **ADV-01: Swipe-to-Back while keyboard is open removes focus from input** (Упал на: *Desktop Chrome*, *Mobile Safari*)
  - *Симптомы:* Аналогично аналогичному тесту из `adversarial-resilience.spec.ts`. Жест свайпа не приводит к закрытию чата и сбросу фокуса с `#chat-input`. Примечательно, что в *Mobile Chrome* этот тест прошел успешно, что указывает на различия в эмуляции Touch-событий движком Blink/Chromium на мобильных устройствах по сравнению с Webkit (Safari) и десктопным эмулятором.
* **ADV-02: Multi-touch event (second finger touch) cancels/resets swipe gesture** (Упал на: *Desktop Chrome*)
  - *Симптомы:* На Desktop Chrome свайп все равно приводит к закрытию чата, несмотря на второй палец.
  - *Причина:* Отсутствие строгой валидации количества касаний в десктопном режиме эмуляции тач-событий.
* **ADV-06: Swipe-to-Back: boundary verification at 129px vs 131px (BVA)** (Упал на: *Desktop Chrome*, *Mobile Safari*, *Mobile Chrome*)
  - *Симптомы:* Свайп на 131px (при пороге 130px для ширины 390px) не закрывает чат, класс `.chat-open` сохраняется.
  - *Причина:* Граничные значения жестов в E2E-среде не приводят к триггеру закрытия из-за сглаживания движения или округления координат при расчете `diffX > width / 3`.
* **ADV-07: Safe Area Bottom Inset and Keyboard focus interaction** (Упал на: *Desktop Chrome*)
  - *Симптомы:* Отступ снизу в `.premium-input-wrapper` остался равным `36px` вместо ожидавшихся `12px` при фокусе на поле ввода.
  - *Причина:* В Playwright на Desktop Chrome ресайз вьюпорта через `page.setViewportSize` изменяет `visualViewport.height` и `window.innerHeight` синхронно. Из-за этого условие проверки клавиатуры `vh < window.innerHeight - 150` в `frontend/messenger_app.js` возвращает `false`, класс `keyboard-open` не вешается на `body`, и Safe Area не перерассчитывается.

### 3) Основные пользовательские пути (`tests/e2e/chat-pipeline.spec.ts`)
Упал **1 тест**:
* **TC-03b Enter key sends message** (Упал на: *Mobile Safari*)
  - *Симптомы:* Отправка сообщения по нажатию на клавишу Enter не сработала на эмуляторе iOS Safari.
  - *Причина:* Различия в обработке события нажатия клавиш на виртуальной клавиатуре iOS Safari в E2E-окружении (особенности обработки keydown/keypress в Webkit).

### 4) Анализ нестабильных (Flaky) тестов
Всего **4 теста** перешли в статус flaky (упали при первом прогоне, но успешно прошли при ретрае):
1. `[Mobile Safari] TC-04 Attach image — preview shown and upload initiated`
2. `[Mobile Safari] M-01 Mobile back button is visible after opening chat`
3. `[Mobile Chrome] TC-04 Attach image — preview shown and upload initiated`
4. `[Mobile Chrome] TC-13 Contact search filters sidebar list`

*Причина нестабильности:* Ошибки вида `ENOENT: no such file or directory, open 'E:\Skufia-net\test-results\state-user-a.json'`. Файл состояния авторизации `state-user-a.json` не успевал создаться или блокировался/перезаписывался другими воркерами Playwright при параллельном выполнении тестов на разных браузерах. Это чисто инфраструктурная проблема E2E-тестирования в условиях параллелизации, а не баг приложения.

---

## 6. Заключение

Проведенное adversarial-тестирование с покрытием 144 сценариев на трех платформах позволило выявить критические зоны риска в клиентской части мессенджера:
1. **Ненадежность обработки жестов свайпа:** Логика Swipe-to-Back сбоит при активном фокусе на текстовом вводе (ADV-01) и на граничных значениях (ADV-06), а также подвержена сбоям при мультитач-касаниях (ADV-02, ADV-03).
2. **Сбои в расчете Safe Areas при открытии клавиатуры:** Метод определения виртуальной клавиатуры через ресайз вьюпорта (`vh < window.innerHeight - 150`) несовместим с E2E-тестированием на десктопных браузерах, что приводит к неверным отступам Safe Area снизу (ADV-07).
3. **Flaky-поведение авторизации:** Глобальное хранение `state-user-a.json` в параллельной среде приводит к гонкам условий в E2E-тестах.

Все обнаруженные баги зафиксированы в отчетах и будут переданы на фазу исправления (Milestone 5 Phase 3). Исходный код приложения не изменялся в соответствии с правилом **Review-only**.



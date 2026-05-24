# Аналитический отчет об исследовании тем оформления и шрифтов (Milestone 2)

**Дата:** 24 мая 2026 г.  
**Рабочая директория:** `e:\Skufia-net\.agents\explorer_m2_1`  
**Статус:** Исследование завершено, сформированы рекомендации для реализации.

---

## 1. Архитектура тем оформления в Skufia-net
Система тем в приложении построена на использовании CSS-переменных, определенных для селектора `:root` (тема по умолчанию — Cyber Glassmorphism) и селекторов `[data-theme="..."]` для альтернативных тем. Всего поддерживается 5 тем оформления:
1. **Cyber Glassmorphism** (дефолтная тема в `:root` и дублирующая в `[data-theme="cyber"]`)
2. **Telegram Dark** (`[data-theme="telegram"]`)
3. **Neon Glassmorphism** (`[data-theme="neon"]`)
4. **Light (iOS Style)** (`[data-theme="light-ios"]`)
5. **Cyber Gold** (`[data-theme="gold"]`)

### Набор основных CSS-переменных тем:
- `--bg-dark` — основной фоновый цвет приложения.
- `--bg-panel` — фон панелей, бокового меню и окон.
- `--bg-accent` — фон активных элементов, ховеров и акцентов.
- `--bg-message-other` — фон пузырей входящих сообщений.
- `--accent-cyan` — основной акцентный цвет (бирюзовый, синий, золотой в зависимости от темы).
- `--accent-amber` — вспомогательный акцентный цвет (желтый, пурпурный, красный в зависимости от темы).
- `--accent-gradient` — градиент для кнопок и выделений.
- `--text-main` — цвет основного текста.
- `--text-dim` — цвет приглушенного/вспомогательного текста.
- `--border-metal` — цвет рамок и разделителей.
- `--glow` — эффект свечения (для кибер-тем).
- `--panel-shadow` — тени панелей.
- `--transition` — тайминги анимаций перехода.
- `--font-main` — шрифт темы (моноширинный JetBrains Mono для кибер-тем, Inter — для классических).
- `--crt-display` — переключатель CRT-эффекта (развертки).
- `--backdrop-blur` — сила размытия фона панелей.
- `--chat-bubble-radius` — радиус скругления сообщений.

---

## 2. Выявленные проблемы и захардкоженные цвета

### 2.1 Контекстные меню сообщений (`.msg-context-menu`)
В файле `frontend/style.css` обнаружены следующие фиксированные цвета в контекстном меню:
- **Тень и рамка меню** (строка 2640):
  ```css
  box-shadow: 0 8px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
  ```
  *Проблема:* Рамка `rgba(255,255,255,0.05)` жестко закодирована под темную тему и будет плохо смотреться в светлой теме `light-ios`.
- **Цвет текста пунктов меню** (строка 3718):
  ```css
  color: #e0e0e0;
  ```
  *Проблема:* Фиксированный серый цвет. В светлой теме текст сольется с белым фоном.
- **Ховер на элементах меню** (строка 3731):
  ```css
  background: rgba(255, 255, 255, 0.08);
  ```
  *Проблема:* Жестко белый полупрозрачный фон. В светлой теме ховер будет неразличим.
- **Активное состояние / клик** (строка 3734):
  ```css
  background: rgba(0, 242, 255, 0.1);
  ```
  *Проблема:* Захардкоженный бирюзовый цвет клика. Должен адаптироваться под акцентный цвет темы.
- **Кнопка удаления сообщения** (строки 3737, 3740):
  ```css
  color: #ff4444;
  background: rgba(255, 68, 68, 0.1); /* hover */
  ```
  *Проблема:* Красный цвет захардкожен напрямую.

### 2.2 Формы авторизации (`#auth-overlay`, `.auth-main-btn` и связанные элементы)
В `frontend/style.css` и `frontend/style-modal.css` элементы авторизации жестко привязаны к бирюзово-черной кибер-теме:
- **Фон оверлея авторизации** (`frontend/style.css`, строка 2268):
  ```css
  background: rgba(0, 0, 0, 0.85);
  ```
  *Проблема:* Захардкоженный черный оверлей.
- **Фоны и тени инпутов** (`frontend/style.css`, строки 324, 335, 608):
  ```css
  background: #000; /* .cyber-input */
  box-shadow: 0 0 10px rgba(0, 255, 65, 0.2); /* focus (зеленый!) */
  background: #05080a; /* input */
  ```
  *Проблема:* Жестко заданный темный фон и зеленый свет при фокусе, не зависящие от выбранной темы.
- **Кнопка авторизации** (`frontend/style-modal.css`, строки 146, 148, 149, 160, 162):
  ```css
  background: linear-gradient(90deg, rgba(0,242,255,0.1) 0%, rgba(0,242,255,0.3) 50%, rgba(0,242,255,0.1) 100%) !important;
  box-shadow: 0 0 15px rgba(0, 242, 255, 0.4), inset 0 0 10px rgba(0, 242, 255, 0.2) !important;
  color: #fff !important;
  /* hover: */
  color: #000 !important;
  box-shadow: 0 0 25px rgba(0, 242, 255, 0.8), inset 0 0 15px rgba(255, 255, 255, 0.5) !important;
  ```
  *Проблема:* Жесткие бирюзовые градиенты и тени.
- **Кнопка «Назад»** (`frontend/style-modal.css`, строки 168, 183):
  ```css
  background: rgba(255, 255, 255, 0.03) !important;
  /* hover: */
  background: rgba(255, 255, 255, 0.08) !important;
  ```
  *Проблема:* Белый полупрозрачный фон не будет виден в светлой теме.
- **Кнопка сохранения настроек** (`frontend/style-modal.css`, строки 190, 196, 211):
  ```css
  background: linear-gradient(135deg, var(--accent-cyan), #0078ff) !important;
  box-shadow: 0 8px 20px rgba(0, 242, 255, 0.3) !important;
  /* hover: */
  box-shadow: 0 12px 30px rgba(0, 242, 255, 0.5) !important;
  ```
  *Проблема:* Захардкоженный синий цвет `#0078ff` в градиенте и бирюзовые тени.

### 2.3 Блок согласия ФЗ-152 (Персональные данные)
В `frontend/index.html` (строки 91-99) и `frontend/messenger.html` (строки 91-99) стили блока ФЗ-152 прописаны инлайново и содержат фиксированные цвета:
```html
<div style="background: rgba(0,242,255,0.05); border: 1px solid rgba(0,242,255,0.2); border-radius: 8px; padding: 12px; margin-bottom: 15px;">
    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 12px; color: var(--text-dim); line-height: 1.5;">
        <input type="checkbox" id="reg-pd-consent" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; cursor: pointer; accent-color: var(--accent-cyan);" onchange="document.getElementById('reg-submit-btn').disabled = !this.checked;">
        <span>Я даю согласие на обработку моих персональных данных в соответствии с 
            <strong style="color: var(--accent-cyan);">Федеральным законом № 152-ФЗ</strong>
            «О персональных данных». Данные используются исключительно для обеспечения работы платформы Skufia-Net и не передаются третьим лицам.
        </span>
    </label>
</div>
```
*Проблема:* Фиксированные бирюзовые цвета `rgba(0,242,255,0.05)` и `rgba(0,242,255,0.2)` сломают визуал блока в светлой теме или золотой теме. Инлайновые стили необходимо вынести в CSS класс с поддержкой переменных.

### 2.4 Выпадающие списки (`select`, `.input-text`)
Выпадающие списки (например, `#theme-selector` в настройках, `#market-sort` и `#market-filter-cat` в Маркете) не имеют стилизации в CSS файлах.
- Они рендерятся с дефолтными стилями браузера, что выглядит некорректно при смене тем.
- Класс `.input-text`, назначенный им в HTML, отсутствует в файлах стилей (есть только `.input-textarea`).

---

## 3. Предложения по заменам и рефакторингу

Для корректной интеграции всех элементов в систему тем предлагаются следующие изменения:

### 3.1 Расширение переменных тем (Добавление деструктивного/красного цвета)
Рекомендуется ввести переменную `--accent-red` (или `--error-color`) во все блоки тем в `style.css`:

| Тема | Значение `--accent-red` | Значение `--accent-red-rgb` |
|---|---|---|
| **Default / Cyber** | `#ff4444` | `255, 68, 68` |
| **Telegram Dark** | `#ec3b3b` | `236, 59, 59` |
| **Neon** | `#f43f5e` | `244, 63, 94` |
| **Light iOS** | `#FF3B30` | `255, 59, 48` |
| **Gold** | `#ff4d4d` | `255, 77, 77` |

### 3.2 Рефакторинг контекстного меню сообщений (`.msg-context-menu`)
В `frontend/style.css`:
```css
/* До: */
.msg-context-menu {
    background: var(--bg-panel);
    border: 1px solid var(--border-metal);
    box-shadow: 0 8px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
}
.msg-context-menu div {
    color: #e0e0e0;
}
.msg-context-menu div:hover {
    background: rgba(255, 255, 255, 0.08);
}
.msg-context-menu div:active {
    background: rgba(0, 242, 255, 0.1);
}
.msg-context-menu .delete-ctx {
    color: #ff4444;
}
.msg-context-menu .delete-ctx:hover {
    background: rgba(255, 68, 68, 0.1);
}

/* После (с использованием переменных): */
.msg-context-menu {
    background: var(--bg-panel);
    border: 1px solid var(--border-metal);
    box-shadow: var(--panel-shadow), 0 0 0 1px var(--border-metal);
}
.msg-context-menu div {
    color: var(--text-main);
}
.msg-context-menu div:hover {
    background: var(--bg-accent);
}
.msg-context-menu div:active {
    background: color-mix(in srgb, var(--accent-cyan) 15%, transparent);
}
.msg-context-menu .delete-ctx {
    color: var(--accent-red, #ff4444);
}
.msg-context-menu .delete-ctx:hover {
    background: color-mix(in srgb, var(--accent-red, #ff4444) 12%, transparent);
}
```

### 3.3 Рефакторинг форм авторизации
В `frontend/style.css`:
```css
/* Оверлей авторизации */
#auth-overlay {
    background: color-mix(in srgb, var(--bg-dark) 85%, transparent);
    backdrop-filter: var(--backdrop-blur);
}
/* Поля ввода */
.cyber-input, .cyber-textarea {
    background: var(--bg-dark);
    color: var(--text-main);
    border: 1px solid var(--border-metal);
}
.cyber-input:focus, .cyber-textarea:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-cyan) 25%, transparent);
}
```

В `frontend/style-modal.css`:
```css
/* Кнопка авторизации */
.auth-main-btn {
    background: linear-gradient(90deg, 
        color-mix(in srgb, var(--accent-cyan) 10%, transparent) 0%, 
        color-mix(in srgb, var(--accent-cyan) 30%, transparent) 50%, 
        color-mix(in srgb, var(--accent-cyan) 10%, transparent) 100%) !important;
    border: 2px solid var(--accent-cyan) !important;
    box-shadow: 0 0 15px color-mix(in srgb, var(--accent-cyan) 40%, transparent), 
                inset 0 0 10px color-mix(in srgb, var(--accent-cyan) 20%, transparent) !important;
    color: var(--text-main) !important;
    text-shadow: var(--glow);
}
.auth-main-btn:hover, .auth-main-btn:active {
    background: var(--accent-cyan) !important;
    color: var(--bg-dark) !important;
    box-shadow: 0 0 25px var(--accent-cyan), 
                inset 0 0 15px color-mix(in srgb, var(--text-main) 50%, transparent) !important;
}
/* Кнопка сохранения настроек */
.save-btn-premium {
    background: var(--accent-gradient) !important;
    color: var(--bg-dark) !important;
    box-shadow: 0 8px 20px color-mix(in srgb, var(--accent-cyan) 30%, transparent) !important;
}
.save-btn-premium:hover {
    box-shadow: 0 12px 30px color-mix(in srgb, var(--accent-cyan) 50%, transparent) !important;
}
```

### 3.4 Вынос стилей ФЗ-152 в CSS класс
В `frontend/style.css` добавить:
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

В `index.html` и `messenger.html` заменить инлайновые стили на созданные классы:
```html
<!-- Было: -->
<div style="background: rgba(0,242,255,0.05); border: 1px solid rgba(0,242,255,0.2); ...">
    <label style="display: flex; ... color: var(--text-dim); ...">
        <input type="checkbox" ... style="... accent-color: var(--accent-cyan);">
        <span>... <strong style="color: var(--accent-cyan);">Федеральным законом № 152-ФЗ</strong> ...</span>
    </label>
</div>

<!-- Стало: -->
<div class="pd-consent-block">
    <label class="pd-consent-label">
        <input type="checkbox" id="reg-pd-consent" class="pd-consent-checkbox" onchange="document.getElementById('reg-submit-btn').disabled = !this.checked;">
        <span>Я даю согласие на обработку моих персональных данных в соответствии с 
            <strong style="color: var(--accent-cyan);">Федеральным законом № 152-ФЗ</strong>
            «О персональных данных». Данные используются исключительно для обеспечения работы платформы Skufia-Net и не передаются третьим лицам.
        </span>
    </label>
</div>
```

### 3.5 Стилизация выпадающих списков (`select`)
Добавить в `frontend/style.css` общие стили для выпадающих списков, адаптирующиеся под темы:
```css
select, .input-text {
    background-color: var(--bg-accent);
    border: 1px solid var(--border-metal);
    color: var(--text-main);
    padding: 8px 12px;
    font-family: var(--font-main);
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

---

## 4. Вывод
Текущая реализация тем оформления Skufia-net имеет сильную привязку к исходной темной киберпанк-теме в критически важных UI-элементах (контекстные меню, форма авторизации, согласие ФЗ-152, выпадающие списки). Использование предложенных изменений и CSS-функции `color-mix` позволит полностью отвязать интерфейс от захардкоженных цветов, сделав его адаптивным ко всем 5 темам, включая светлую iOS-тему и Cyber Gold.

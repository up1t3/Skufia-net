# 🎨 Дизайн-система Skufia-Net: Глобальные переменные (CSS Variables)

Данная документация описывает глобальную стандартизированную дизайн-систему, используемую во всём приложении Skufia-Net: как в мессенджере, так и в Личном Кабинете (Personal Cabinet), меню опций (Chat Options), Маркетплейсе, и других разделах.

Интерфейс спроектирован с полным отказом от хардкодинга (`#10b981`, `rgba(0, 242, 255, 0.1)`, `var(--neon-green)`). Переключение между темами (Dark Neon, Light iOS) происходит исключительно через подмену значений "семантических" CSS переменных на уровне корневого элемента `<html data-theme="...">`.

---

## 📌 Основные семантические переменные

Все компоненты интерфейса (модалки, чекбоксы, панели чата, профиль пользователя) должны использовать данные переменные, а не прямые hex-цвета.

### 1. Фоны (Backgrounds)
*   **`--bg-main`** — Основной, самый глубокий фон страницы (Body background).
*   **`--bg-panel`** — Основной фон функциональных панелей, модальных окон, сайдбаров и блоков (Cards, Sidebar).
*   **`--bg-dark`** — Резервный контрастный базовый фон (используется для аватарок, вводов текста и заглушек).
*   **`--bg-accent`** — Акцентный полупрозрачный фон для наведения, hover-состояний кнопок, выделенных элементов списков. Заменяет все legacy `rgba(0, 242, 255, 0.1)`.

### 2. Текст (Typography)
*   **`--text-main`** — Главный цвет текста, должен быть высококонтрастным (белый для темных тем, черный для светлых). Заменяет старые `color: #fff`.
*   **`--text-dim`** — Второстепенный текст (серый), для плейсхолдеров, времени сообщений, статусов ("Был в сети"). Заменяет старые `color: #aaa`.

### 3. Акценты и Бренд (Brand & Accents)
*   **`--accent-cyan`** — Ключевой брендовый цвет взаимодействия (Кнопка отправки, иконки профиля, галочки "Skufenger", ссылки). В теме Neon он "кибер-голубой" (`#00f2ff`), в теме iOS-Light он классический системный синий (`#007AFF`). Заменяет старые `var(--neon-green)` и жестко заданный голубой цвет.
*   **`--accent-gradient`** — Градиент для ключевых Action-кнопок (например, FAB "Создать чат").
*   **`--panel-shadow`** — Свечение или тень для акцентных кнопок. Заменяет хардкодные `box-shadow: 0 0 10px rgba(..., 0.2)`.

### 4. Бордеры и разделители (Borders)
*   **`--border-metal`** — Основной цвет линий, рамок модальных окон, разделителей в чате и инпутах. Встраивается во все компоненты. Заменяет старый `var(--border-color)` и `var(--neon-dim)`.

---

## 🎭 Цветовые схемы модулей

### A. Модуль Мессенджера (Chat Module)

*   **.chat-sidebar**:
    *   Фон: `var(--bg-panel)`
    *   Разделитель: `border-right: 1px solid var(--border-metal)`
*   **.sidebar-item (Chat Row)**:
    *   Текст Имя: `color: var(--text-main)`
    *   Текст Сообщения: `color: var(--text-dim)`
    *   Hover: `background: var(--bg-accent)`
*   **.chat-main (Сообщения)**:
    *   Моё сообщение (Outgoing): Цвет пузыря обычно берется из `--accent-cyan` или градиента, текст белый.
    *   Чужое сообщение (Incoming): Цвет пузыря `var(--bg-panel)`, бордер `var(--border-metal)`, текст `color: var(--text-main)`.
*   **.chat-options-dropdown (Меню чата)**:
    *   Фон: `var(--bg-panel)`
    *   Разделитель кнопки: `border: 1px solid var(--border-metal)`
    *   Hover кнопок: `color: var(--accent-cyan); background: var(--bg-accent)`

### B. Модуль Личного Кабинета (Personal Cabinet)

Личный Кабинет Скуфа (`#skufia-cabinet-modal`) был значительно переписан, чтобы удалить прямые Neon-флаги.

*   **Шапка профиля (`.profile-header`)**:
    *   Фон: `var(--bg-accent)`
    *   Бордер: `1px solid var(--border-metal)`
    *   Декоративная верхняя линия (Градиент): `linear-gradient(90deg, transparent, var(--accent-cyan), transparent)`
*   **Аватар Контейнер (`.avatar-container`)**:
    *   Бордер: `2px solid var(--accent-cyan)`
*   **Типографика профиля (`.profile-info h2`)**:
    *   Цвет: `var(--accent-cyan)`
*   **Декоративные элементы (`.nav-btn:hover`)**:
    *   Цвет и Бордер: `var(--accent-cyan)`
    *   Свечение: `var(--panel-shadow)`

### C. Общие модальные окна (Forms / Settings)
*   **Окно (`.modal-content`)**: 
    *   Фон: `var(--bg-panel)`
    *   Бордер: `var(--border-metal)`
*   **Инпуты (`.skufeng-input`)**:
    *   Фон: `var(--bg-dark)`
    *   Фокус: `border-color: var(--accent-cyan)`

---

## 🎨 Темы (Themes)

Система поддерживает динамическое применение стилей:

### Тема 1: "Neon Glass" (`[data-theme="neon"]`)
Фокус на киберпанке, стеклянных градиентах и свечении:
```css
:root[data-theme="neon"] {
    --bg-main: #0B0E14;
    --bg-panel: rgba(20, 25, 35, 0.7);
    --bg-dark: #07090D;
    --bg-accent: rgba(0, 242, 255, 0.1);
    
    --text-main: #FFFFFF;
    --text-dim: #7B8C9C;
    
    --accent-cyan: #00F2FF;
    --accent-gradient: linear-gradient(135deg, #00f2ff, #0088ff);
    
    --border-metal: rgba(0, 242, 255, 0.2);
    --panel-shadow: 0 0 10px rgba(0, 242, 255, 0.2);
}
```

### Тема 2: "Light iOS" (`[data-theme="light-ios"]`)
Фокус на чистоте ("Apple" style), высоком контрасте, системных цветах и легких тенях (Shadow, не Glow):
```css
:root[data-theme="light-ios"] {
    --bg-main: #F2F2F7;
    --bg-panel: rgba(255, 255, 255, 0.85); /* Glass effect */
    --bg-dark: #FFFFFF;
    --bg-accent: rgba(0, 122, 255, 0.1);
    
    --text-main: #000000;
    --text-dim: #8E8E93;
    
    --accent-cyan: #007AFF; /* System Blue */
    --accent-gradient: linear-gradient(135deg, #0A7BFF, #3E94FF);
    
    --border-metal: rgba(60, 60, 67, 0.36);
    --panel-shadow: 0 4px 12px rgba(0,0,0, 0.08); /* Тени вместо свечения */
}
```

---

## ✅ Правила для разработчиков

1. **Никаких Hex-цветов в CSS правилах модулей.** Если вам нужен красный цвет, используйте `var(--accent-danger)`. Если вам нужен фон — `var(--bg-panel)`.
2. **Никаких `rgba()` с жестко заданным `(0, 242, 255` прямо в CSS классах. Используйте `var(--bg-accent)`.
3. **Любой новый модуль** (всплывающее окно, дропдаун, секция) должен тестироваться в ДВУХ темах минимум (Light iOS и Neon Glass) для валидации переменных.

# 🎨 Дизайн-система Skufia-Net: Светлая тема (Light iPhone Style)

Данный документ описывает цветовую схему и элементы стиля для светлой темы мессенджера и приложения, основанной на принципах дизайна iOS (iPhone Style).

## 📌 Основные принципы (Light iOS Theme)

1. **Кристальная чистота (Clarity):** Использование белого и светло-серого пространства для фокусировки на контенте.
2. **Воздушность (Translucency):** Применение эффекта матового стекла (Frosted Glass / Backdrop Filter) для навигационных панелей, шапок и модальных окон.
3. **Глубина (Depth):** Тонкие, естественные тени, которые создают многослойность без утяжеления интерфейса.
4. **Типографика:** Системный шрифт (San Francisco / Inter) с отличным антиалиасингом и контрастом.

---

## 🎨 Цветовая Палитра (CSS Variables)

Для внедрения светлой темы в `index.css` необходимо использовать следующую палитру переменных:

### 1. Фоны (Backgrounds)
*   **Главный фон приложения (App Background):** `#F2F2F7` (iOS System Grouped Background) — используется для страниц с карточками.
*   **Фон контента / Чат-зоны (Content Background):** `#FFFFFF` — чисто белый для области сообщений.
*   **Фон с эффектом стекла (Glass Background):** `rgba(255, 255, 255, 0.75)` с `backdrop-filter: blur(20px)` (для шапок и нижних панелей навигации).

### 2. Текст (Typography)
*   **Основной текст (Primary Text):** `#000000` (iOS Label) — для заголовков и основного контента.
*   **Вторичный текст (Secondary Text):** `#8E8E93` (iOS Secondary Label) — для дат, подписей и статусов ("Был в сети").
*   **Третичный текст (Tertiary Text):** `#C7C7CC` — для плейсхолдеров и неактивных элементов.

### 3. Акценты и Действия (Accents & Interactions)
*   **Главный акцент / Ссылки (Primary Accent - Блю):** `#007AFF` (iOS System Blue) — для кнопок отправки, активных иконок, ссылок и галочек прочтения.
*   **Удаление / Ошибки / Отмена (Destructive - Ред):** `#FF3B30` (iOS System Red).
*   **Успех / Защита (Success - Грин):** `#34C759` (iOS System Green) — для индикаторов онлайна и уведомлений.
*   **Предупреждения (Warning - Оранж):** `#FF9500` (iOS System Orange).

### 4. Сообщения в мессенджере (Chat Bubbles)
*   **Мои сообщения (Outgoing Bubble):**
    *   Фон: `#007AFF` (или `#0B84FF` для чуть большей мягкости).
    *   Текст: `#FFFFFF`.
*   **Чужие сообщения (Incoming Bubble):**
    *   Фон: `#E9E9EB`.
    *   Текст: `#000000`.

### 5. Элементы интерфейса (Borders & Dividers)
*   **Разделители (Dividers):** `rgba(60, 60, 67, 0.36)` — тонкие серые линии толщиной в `0.5px` (через псевдоэлементы или тонкие бордеры).
*   **Рамки полей ввода (Input Borders):** `#D1D1D6`.
*   **Фон полей ввода (Input Background):** `#FFFFFF` или `#F2F2F7` (в зависимости от подложки).

---

## 🛠️ Пример интеграции в CSS

```css
:root[data-theme="light-ios"] {
    /* Фоны */
    --bg-main: #F2F2F7;
    --bg-content: #FFFFFF;
    --bg-glass: rgba(255, 255, 255, 0.75);
    
    /* Текст */
    --text-primary: #000000;
    --text-secondary: #8E8E93;
    
    /* Акценты */
    --accent-color: #007AFF;
    --accent-danger: #FF3B30;
    --accent-success: #34C759;
    
    /* Сообщения */
    --msg-incoming-bg: #E9E9EB;
    --msg-incoming-text: #000000;
    --msg-outgoing-bg: #007AFF;
    --msg-outgoing-text: #FFFFFF;
    
    /* Бордеры */
    --border-color: rgba(60, 60, 67, 0.36);
    --input-border: #D1D1D6;
    
    /* Тени */
    --shadow-sm: 0 1px 2px rgba(0,0,0, 0.05);
    --shadow-md: 0 4px 12px rgba(0,0,0, 0.08);
}
```

## 📱 Рекомендации по UX/UI (а-ля iMessage / Telegram iOS)

1. **Скругления (Border Radius):** Эппловские интерфейсы используют "Squircle" скругления. Для кроссбраузерности установите `border-radius: 12px` для карточек и `18px` для пузырей сообщений.
2. **Свайпы:** Реализация swipe-to-delete или swipe-to-reply с плавными анимациями.
3. **Хедеры с размытием:** Используйте CSS:
```css
.sidebar-header, .chat-header {
    background: var(--bg-glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px); /* Важно для Safari */
    border-bottom: 0.5px solid var(--border-color);
}
```
4. **Контекстные меню:** Долгое нажатие по сообщению должно открывать меню действий с лёгкой тенью (`box-shadow: 0 10px 30px rgba(0,0,0, 0.1)`) и белым фоном.

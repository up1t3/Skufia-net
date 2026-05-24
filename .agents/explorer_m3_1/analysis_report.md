# АНАЛИТИЧЕСКИЙ ОТЧЕТ: Исследование использования Safe Areas в мессенджере SKUFenger

**Milestone:** 3 (Мобильная адаптивность и Safe Areas)  
**Автор:** Explorer (Инстанс 1)  
**Дата:** 24 мая 2026 г.  

---

## 1. Введение и цели исследования
Целью данного исследования является аудит мобильной адаптивности интерфейса мессенджера SKUFenger (в рамках портала Skufia-net) и анализ поддержки безопасных зон (Safe Areas) на мобильных устройствах (iOS/Android) с вырезами на экранах (челки, Dynamic Island, вырезы под камеры, скругления углов, системные панели управления).

### Задачи исследования:
1. Изучить верстку (`frontend/index.html`, `frontend/messenger.html`) и CSS-стили (`frontend/style.css`, `frontend/chat.css`, `frontend/style-modal.css`).
2. Проанализировать корректность рендеринга ключевых элементов: шапки чата, сайдбара, области ввода сообщений, модальных окон и оверлеев.
3. Разработать рекомендации и конкретные CSS-правила для мобильных вьюпортов (`max-width: 768px`) для предотвращения перекрытия элементов интерфейса системными элементами ОС.

---

## 2. Анализ текущего состояния верстки и стилей

### 2.1. Мета-теги и базовая поддержка
В файлах `frontend/index.html` (строка 5) и `frontend/messenger.html` (строка 5) обнаружен корректный мета-тег viewport:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```
Параметр `viewport-fit=cover` сообщает браузеру (особенно Safari на iOS), что страница должна занимать весь физический экран устройства, включая зоны под вырезами. Это необходимое условие для работы CSS-функций `env(safe-area-inset-*)`.

Также в обоих файлах настроена поддержка PWA (строки 21-22 в `index.html` и 14-15 в `messenger.html`):
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```
Значение `black-translucent` делает статус-бар прозрачным, из-за чего веб-приложение рендерится непосредственно под ним. Без правильного позиционирования элементов это приводит к наложению системных часов и индикаторов на элементы заголовка сайта.

### 2.2. Текущее использование Safe Areas в CSS
В файле `frontend/style.css` обнаружены следующие конструкции:
1. Строка 23: Определение CSS-переменной для нижней безопасной зоны:
   ```css
   --safe-bottom: env(safe-area-inset-bottom, 0px);
   ```
2. Строка 1060 (в контексте `.scroll-bottom-btn` или других элементов):
   ```css
   bottom: calc(24px + env(safe-area-inset-bottom));
   ```
3. Строка 1564: Смещение нижней зоны ввода (`.premium-input-wrapper`):
   ```css
   padding-bottom: max(12px, calc(12px + env(safe-area-inset-bottom)));
   ```
4. Строка 3208: Нижний отступ зоны ввода в полноэкранном режиме мессенджера (`body.skufenger-fullscreen .premium-input-wrapper`):
   ```css
   padding-bottom: calc(12px + var(--safe-bottom, 0px));
   ```

**Вывод по текущему состоянию:**
Частичная поддержка Safe Areas реализована *только* для нижнего отступа области ввода сообщений в портретной ориентации. Однако боковые зоны (`safe-area-inset-left`, `safe-area-inset-right`), верхняя зона (`safe-area-inset-top`), а также модальные окна полностью игнорируют параметры безопасных зон.

---

## 3. Выявленные проблемы и риски перекрытия интерфейса

### 3.1. Сайдбар (`.chat-sidebar`) и его заголовок (`.sidebar-header`)
- **Портретный режим:** При запуске в режиме PWA статус-бар перекрывает верхнюю часть сайдбара `.sidebar-header`. Иконка меню и заголовок "Все чаты" накладываются на системные индикаторы.
- **Альбомный режим (Landscape):** Сайдбар занимает 100% ширины экрана на мобильных устройствах при `max-width: 768px`. В альбомном режиме челка (которая оказывается слева или справа) перекрывает аватары пользователей в списке чатов (`.chat-item`) или иконки папок (`.chat-folders-tabs`), делая их некликабельными.

### 3.2. Шапка чата (`.chat-info` / `#chat-header`)
- **Портретный режим:** Имя собеседника (`#chat-header-title`), статус (`#chat-header-status`) и кнопки вызовов перекрываются челкой.
- **Альбомный режим (Landscape):** Кнопка "Назад" (`.mobile-back-btn`) слева и кнопка вызова/опций справа попадают прямо под вырез экрана.

### 3.3. Область ввода сообщений (`.premium-input-wrapper`)
- **Альбомный режим (Landscape):** Кнопка открытия эмодзи (`.emoji-toggle-btn`) слева и кнопки отправки (`#send-chat-btn`, `#voice-record-btn`) справа прижимаются к краям экрана. При наличии челки слева или справа интерактивные кнопки становятся недоступными для нажатия.

### 3.4. Всплывающая кнопка прокрутки (`.scroll-bottom-btn`)
- При открытии клавиатуры или изменении высоты ввода кнопка прокрутки может наезжать на элементы управления. В альбомном режиме она прижата к правому краю (`right: 20px`), что делает ее уязвимой для перекрытия боковым вырезом.

### 3.5. Модальные окна и оверлеи (`.modal`, `.modal-content`)
- В файле `style-modal.css` **полностью отсутствуют** упоминания Safe Areas.
- В мобильном режиме (`max-width: 768px`) модальные окна превращаются в нижние шторки (Action Sheets) через `align-items: flex-end !important`.
- Внизу задан фиксированный `padding-bottom: 30px !important`. На некоторых смартфонах с высоким Home Bar (например, iPhone 14/15 Pro) интерактивные элементы внизу шторки (такие как кнопка "Сохранить", чекбокс согласия 152-ФЗ) будут слишком близко к системной полосе жестов. На устройствах без челки (Android с кнопками) этот отступ избыточен.
- В альбомном режиме контент модальных окон прижимается к боковым краям и перекрывается вырезами.

---

## 4. Рекомендации по оптимизации и CSS-правила

Предлагается внедрить структурированный набор CSS-правил для мобильных вьюпортов (`max-width: 768px`). Изменения должны быть добавлены в соответствующие секции медиа-запросов.

### 4.1. Корректировка шапки чата и сайдбара

Необходимо динамически увеличивать высоту шапок в зависимости от наличия статус-бара / челки сверху.

```css
/* Добавить в медиа-запрос @media (max-width: 768px) в style.css или chat.css */

/* Корректировка шапки сайдбара */
.sidebar-header,
body.skufenger-fullscreen .sidebar-header {
    padding-top: env(safe-area-inset-top, 0px) !important;
    height: calc(60px + env(safe-area-inset-top, 0px)) !important;
    padding-left: calc(16px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(16px + env(safe-area-inset-right, 0px)) !important;
}

/* Корректировка шапки чата */
.chat-info,
body.skufenger-fullscreen .chat-info {
    padding-top: env(safe-area-inset-top, 0px) !important;
    height: calc(60px + env(safe-area-inset-top, 0px)) !important;
    padding-left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(20px + env(safe-area-inset-right, 0px)) !important;
}
```

### 4.2. Боковая безопасность сайдбара и контента чата

Для альбомной ориентации необходимо сдвинуть содержимое списка чатов и сообщений:

```css
/* Список чатов в сайдбаре */
.chat-sidebar {
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
}

/* Вкладки папок в сайдбаре */
.chat-folders-tabs {
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
}

/* Область сообщений чата */
.chat-messages,
body.skufenger-fullscreen .chat-messages {
    padding-left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(20px + env(safe-area-inset-right, 0px)) !important;
}
```

### 4.3. Область ввода сообщений и элементы управления

Обеспечиваем отступы слева и справа для альбомного режима и корректное позиционирование кнопки прокрутки:

```css
/* Область ввода сообщений */
.premium-input-wrapper,
body.skufenger-fullscreen .premium-input-wrapper {
    padding-left: calc(16px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(16px + env(safe-area-inset-right, 0px)) !important;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
}

/* Абсолютно позиционированное меню вложений */
.attach-menu-popup {
    left: calc(10px + env(safe-area-inset-left, 0px)) !important;
}

/* Кнопка скролла к низу */
.scroll-bottom-btn {
    bottom: calc(80px + env(safe-area-inset-bottom, 0px)) !important;
    right: calc(20px + env(safe-area-inset-right, 0px)) !important;
}
```

### 4.4. Модальные окна и оверлеи (в `style-modal.css`)

Модальные шторки на мобильных должны безопасно огибать системный индикатор Home Bar снизу и вырезы по бокам:

```css
/* Добавить в @media (max-width: 768px) в style-modal.css */
.modal-content {
    padding-left: calc(24px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(24px + env(safe-area-inset-right, 0px)) !important;
    padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important;
}

/* Для центрированных оверлеев (например, авторизации #auth-overlay) */
#auth-overlay.modal, 
.auth-modal-custom {
    padding-top: calc(20px + env(safe-area-inset-top, 0px)) !important;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important;
    padding-left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    padding-right: calc(20px + env(safe-area-inset-right, 0px)) !important;
}
```

---

## 5. Выводы
Внедрение предложенных правил позволит:
1. Исключить наложение элементов шапки чата на системный статус-бар iOS/Android при использовании PWA в портретном режиме.
2. Обеспечить полную работоспособность всех интерактивных кнопок (назад, эмодзи, вложения, запись голоса, отправка) в альбомной ориентации на безрамочных смартфонах.
3. Сделать поведение нижних модальных шторок полностью адаптивным под физические параметры устройства, убрав жестко захардкоженные отступы.

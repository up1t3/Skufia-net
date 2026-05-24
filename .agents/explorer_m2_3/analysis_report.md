# Аналитический отчет: Темы оформления и шрифты (UI/UX) — Milestone 2

## Введение
Данный отчет подготовлен Explorer суб-агентом (Инстанс 3) в рамках анализа кодовой базы проекта **Skufia-net** для реализации Milestone 2 (Темы оформления и шрифты). Цель исследования — каталогизировать все поля ввода в интерфейсе авторизации и мессенджера, оценить их CSS-стили на мобильных устройствах, разработать рекомендации по предотвращению автоматического зума на iOS и проанализировать структуру сквозных (e2e) тестов на Playwright.

---

## 1. Реестр полей ввода (input, textarea, select)

Ниже представлена детальная таблица всех элементов ввода, обнаруженных в файлах `frontend/index.html` и `frontend/messenger.html`.

| № | Файл | Строка | ID элемента / Имя | Тип тега & Type | Назначение / Контекст | Текущий размер шрифта (мобильный) |
|---|---|---|---|---|---|---|
| **1** | `index.html` | 35 | `#login-username` | `input[type="text"]` | Логин в форме авторизации | `16px !important` (в `.modal-content`) |
| **2** | `index.html` | 40 | `#login-password` | `input[type="password"]` | Пароль в форме авторизации | `16px !important` (в `.modal-content`) |
| **3** | `index.html` | 60 | `#unlock-password` | `input[type="password"]` | Пароль разблокировки сессии | `16px !important` (в `.modal-content`) |
| **4** | `index.html` | 75 | `#reg-username` | `input[type="text"]` | Имя пользователя (Регистрация) | `16px !important` (в `.modal-content`) |
| **5** | `index.html` | 79 | `#reg-email` | `input[type="email"]` | E-mail (Регистрация) | `16px !important` (в `.modal-content`) |
| **6** | `index.html` | 84 | `#reg-password` | `input[type="password"]` | Пароль (Регистрация) | `16px !important` (в `.modal-content`) |
| **7** | `index.html` | 93 | `#reg-pd-consent` | `input[type="checkbox"]` | Согласие на обработку ПД | Не задан (дефолт) |
| **8** | `index.html` | 178 | `#settings-handle` | `input[type="text"]` | Смена никнейма в настройках | `16px !important` (в `.modal-content`) |
| **9** | `index.html` | 189 | `#settings-sound-toggle` | `input[type="checkbox"]` | Вкл/выкл звука | Не задан (дефолт) |
| **10** | `index.html` | 194 | `#settings-enter-toggle` | `input[type="checkbox"]` | Отправка по Enter | Не задан (дефолт) |
| **11** | `index.html` | 200 | `#settings-media-toggle` | `input[type="checkbox"]` | Автозагрузка медиа | Не задан (дефолт) |
| **12** | `index.html` | 205 | `#chat-bg-upload` | `input[type="file"]` | Загрузка фона чата | Не задан (дефолт) |
| **13** | `index.html` | 217 | `#folder-name-input` | `input[type="text"]` | Название папки чатов | `16px !important` (в `.modal-content`) |
| **14** | `index.html` | 225 | `[name="folder-chats"]` | `input[type="checkbox"]` | Выбор чатов для папки | Не задан (дефолт) |
| **15** | `index.html` | 243 | `#folder-chats-search` | `input[type="text"]` | Поиск чатов для папки | `16px !important` (в `.modal-content`) |
| **16** | `index.html` | 269 | `#fab-contact-search` | `input[type="text"]` | Поиск контактов при создании чата | `16px !important` (в `.modal-content`) |
| **17** | `index.html` | 291 | `#create-room-input` | `input[type="text"]` | Название новой комнаты | `16px !important` (в `.modal-content`) |
| **18** | `index.html` | 292 | `#create-room-desc` | `textarea` | Описание новой комнаты | Не задан (дефолт / наследуется) |
| **19** | `index.html` | 295 | `#create-room-public` | `input[type="checkbox"]` | Публичная комната | Не задан (дефолт) |
| **20** | `index.html` | 311 | `#add-member-search` | `input[type="text"]` | Поиск участников для добавления | `16px !important` (в `.modal-content`) |
| **21** | `index.html` | 333 | `#room-members-search` | `input[type="text"]` | Поиск участников комнаты | `16px !important` (в `.modal-content`) |
| **22** | `index.html` | 358 | `#media-preview-caption` | `input[type="text"]` | Подпись к медиафайлу | `16px !important` (в `.modal-content`) |
| **23** | `index.html` | 549 | `#contact-search` | `input[type="text"]` | Главный поиск контактов в сайдбаре | Не задан (дефолт / наследуется) |
| **24** | `index.html` | 569 | `#chat-input` | `textarea` (в `.chat-capsule`) | Поле ввода сообщения в чате | `16px` (в `.chat-input`, `style.css:1613`) |
| **25** | `index.html` | 654 | `#market-search` | `input[type="text"]` | Поиск на Барахолке (в экшн-баре) | Не задан (дефолт / наследуется) |
| **26** | `index.html` | 656 | `#market-min-price` | `input[type="number"]` | Мин. цена на Барахолке | Не задан (дефолт / наследуется) |
| **27** | `index.html` | 657 | `#market-max-price` | `input[type="number"]` | Макс. цена на Барахолке | Не задан (дефолт / наследуется) |
| **28** | `index.html` | 659 | `#market-sort` | `select` | Сортировка на Барахолке | Не задан (дефолт / наследуется) |
| **29** | `index.html` | 665 | `#market-filter-cat` | `select` | Фильтр категорий на Барахолке | Не задан (дефолт / наследуется) |
| **30** | `index.html` | 672 | `#market-filter-loc` | `select` | Фильтр локаций на Барахолке | Не задан (дефолт / наследуется) |
| **31** | `index.html` | 686 | `#market-title` | `input[type="text"]` | Название лота (в форме добавления) | Не задан (дефолт / наследуется) |
| **32** | `index.html` | 687 | `#market-price` | `input[type="text"]` | Цена лота (в форме добавления) | Не задан (дефолт / наследуется) |
| **33** | `index.html` | 688 | `#market-cat` | `select` | Категория лота (в форме добавления) | Не задан (дефолт / наследуется) |
| **34** | `index.html` | 694 | `#market-loc` | `select` | Локация лота (в форме добавления) | Не задан (дефолт / наследуется) |
| **35** | `index.html` | 701 | `#market-desc` | `textarea` | Описание лота (в форме добавления) | `14px` (наследуется из `.input-textarea`) |
| **36** | `index.html` | 745 | `#event-title` | `input[type="text"]` | Название события (форма добавления) | Не задан (дефолт / наследуется) |
| **37** | `index.html` | 746 | `#event-date` | `input[type="datetime-local"]` | Дата события (форма добавления) | Не задан (дефолт / наследуется) |
| **38** | `index.html` | 747 | `#event-location` | `input[type="text"]` | Место события (форма добавления) | Не задан (дефолт / наследуется) |
| **39** | `index.html` | 748 | `#event-desc` | `textarea` | Описание события (форма добавления) | `14px` (наследуется из `.input-textarea`) |
| **40** | `index.html` | 837 | `#theme-selector` | `select` | Селектор тем оформления | Не задан (дефолт / наследуется) |
| **41** | `index.html` | 895 | `#dash-callsign-input` | `input[type="text"]` | Позывной в Кабинете | Не задан (дефолт / наследуется) |
| **42** | `index.html` | 913 | `#dash-bio` | `textarea` | Биография в Кабинете | Не задан (дефолт / наследуется) |
| **43** | `messenger.html` | (Все те же) | (Все аналогичные поля) | (Все аналогичные теги) | Поля дублируются в `messenger.html` | (Аналогично `index.html`) |

---

## 2. Анализ мобильных CSS-стилей (вьюпорты max-width: 768px и др.)

В ходе анализа стилей во `frontend/style-modal.css`, `frontend/style.css` и `frontend/chat.css` были сделаны следующие ключевые наблюдения:

### 2.1. Частичное решение в `style-modal.css`
В файле `frontend/style-modal.css` на строках 130–136 присутствует медиа-запрос для мобильных устройств:
```css
@media (max-width: 768px) {
    ...
    /* Make inputs slightly larger for easier tapping on mobile */
    .modal-content input[type="text"],
    .modal-content input[type="password"],
    .modal-content input[type="email"] {
        height: 52px !important;
        font-size: 16px !important; /* Prevents iOS auto-zoom */
    }
}
```
**Вывод:** Это решение успешно предотвращает автозум на iOS для текстовых полей ввода, находящихся внутри модальных окон (класс `.modal-content`).

### 2.2. Серьезные пробелы и риски (Несоответствие требованию >= 16px)
Вне модальных окон или для специфических типов полей требования к размеру шрифта **не соблюдаются**:
1. **Элементы `textarea` and `select`:**
   - Для `select` во всем проекте вообще отсутствуют какие-либо стили в CSS (стилизуются браузером по умолчанию).
   - Для `.input-textarea` (используется для описания лотов барахолки и описания событий) жестко задан `font-size: 14px;` (см. `style.css:2296`). На мобильных устройствах это значение сохраняется, что вызывает автоматический зум при фокусе на iOS Safari.
   - Для `#create-room-desc` (описание новой комнаты) в `index.html` размер шрифта на мобильных не переопределяется и остается меньше 16px.
   - Для `#dash-bio` (биография в личном кабинете) в `style.css:641` используется селектор `.dash-bio-section textarea` с `font-size: 13px;`, что также приводит к зуму.
2. **Поля ввода вне `.modal-content`:**
   - Поля Барахолки (`#market-search`, `#market-min-price`, `#market-max-price`, `#market-title`, `#market-price`, `#market-cat`, `#market-loc`) и Событий (`#event-title`, `#event-date`, `#event-location`) находятся внутри обычных панелей (класс `.form-panel` или экшн-бары), поэтому правила из `style-modal.css` на них **не распространяются**. Их размер шрифта на мобильных устройствах наследуется как дефолтный (обычно 13-14px), что приводит к зуму.
   - Главный поиск контактов в сайдбаре (`#contact-search` в `.sidebar-search-compact` или `.sidebar-search`) также имеет размер шрифта `13px` (см. `style.css:1041`), что вызывает зум на iOS.
   - Текстовое поле ввода сообщения `#msg-input` в `style.css:810` имеет `font-size: 14px;` и не переопределяется для мобильных экранов.

### 2.3. Влияние мета-тега `viewport`
В обоих HTML-файлах используется мета-тег:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```
*Историческая справка:* `user-scalable=no` и `maximum-scale=1.0` предназначались для блокирования зума. Однако, начиная с iOS 10, Safari игнорирует эти параметры, чтобы пользователи с нарушениями зрения могли масштабировать страницы.
Тем не менее, **автоматический зум при фокусе** на инпуты с шрифтом `< 16px` все еще происходит в iOS Safari. При этом, из-за запрета ручного масштабирования (в тех браузерах, которые его поддерживают) или просто из-за самого сдвига экрана, верстка PWA "ломается", элементы уплывают за границы экрана, и приложением становится неудобно пользоваться. Единственный надежный способ убрать этот раздражающий эффект — гарантировать, что все интерактивные элементы ввода имеют `font-size >= 16px`.

---

## 3. Рекомендации и предложения по изменению CSS

Чтобы полностью устранить автозум на iOS и обеспечить соответствие стандарту UX для всех полей ввода, необходимо внести изменения в CSS.

### Предложение: Глобальное переопределение размеров шрифта для мобильных устройств
Рекомендуется добавить в конец `frontend/style.css` (или в секцию мобильных медиа-запросов `@media (max-width: 768px)`) общее правило, принудительно задающее минимальный размер шрифта 16px для всех интерактивных элементов ввода на мобильных экранах.

#### Пример CSS-доработки:
```css
@media (max-width: 768px) {
    /* Обеспечиваем размер шрифта не менее 16px для предотвращения автоматического зума на iOS */
    input[type="text"],
    input[type="password"],
    input[type="email"],
    input[type="number"],
    input[type="search"],
    input[type="tel"],
    input[type="url"],
    input[type="datetime-local"],
    select,
    textarea,
    .cyber-input,
    .cyber-textarea,
    .input-textarea,
    #msg-input,
    #contact-search,
    .sidebar-search input,
    .sidebar-search-compact input {
        font-size: 16px !important;
    }
}
```

Этот патч гарантирует:
1. Отсутствие автозума на iOS во всех формах (барахолка, события, чат, настройки, поиск).
2. Удобство ввода пальцем (крупный читаемый шрифт).
3. Сохранение текущих стилей на десктопе.

---

## 4. Исследование сквозных (e2e) тестов на Playwright

В проекте настроена полноценная система e2e тестирования на базе Playwright (каталог `tests/e2e/`).

### 4.1. Анализ конфигурации (`playwright.config.ts`)
Файл конфигурации определяет три тестовых окружения (проекта):
1. **Desktop Chrome:** Стандартное десктопное тестирование. Передаются флаги для эмуляции медиа-потоков (микрофон, камера) без вызова нативных диалогов ОС: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`.
2. **Mobile Safari (iPhone 14):** Эмулирует мобильный Safari на iPhone 14. Это ключевое окружение для проверки верстки под iOS, адаптивности и потенциальных проблем с масштабированием.
3. **Mobile Chrome (Pixel 7):** Эмулирует Chrome на Android. Также настроены фейковые медиа-потоки для тестирования WebRTC звонков.

### 4.2. Обзор существующих тестов
- `auth.spec.ts` — Тестирует процесс авторизации (проверка вывода ошибок без перезагрузки страницы).
- `chat-media.spec.ts` — Тестирует функционал мессенджера: поиск контактов (`QA-403`), визуальное отображение процесса записи аудиосообщений (`QA-402`).
- `chat-pipeline.spec.ts` — Основной сквозной тест, покрывающий полный пользовательский сценарий:
  - Вход в приложение и отображение сайдбара (`TC-01`).
  - Выбор чата и появление класса `.chat-open` (`TC-02`).
  - Отправку сообщений через кнопку и Enter (`TC-03`, `TC-03b`, `TC-03c`).
  - Загрузку картинок с валидацией расширений (`TC-04`, `TC-04b`).
  - Работу с эмодзи-панелью (`TC-05`).
  - Переключение состояний кнопки записи голоса (`TC-06`, `TC-06b`).
  - Поведение выпадающего меню чата (`TC-07`, `TC-07b`, `TC-07c`).
  - Инициацию аудио/видео вызовов (`TC-08`, `TC-09`).
  - Просмотр профиля контакта (`TC-10`, `TC-10b`, `TC-10c`).
  - Навигацию "Назад" на мобильных (`TC-11`, `TC-11b`, `TC-12`, `TC-13`, `TC-13b`).
  - Дополнительно содержит отдельный тестовый набор `Chat Pipeline — Mobile 390×844` специально для мобильных вьюпортов.
- `mobile-rtc.spec.ts` — Тестирует WebRTC-соединение и логику звонков в мобильном режиме.

### 4.3. Инструкция по запуску тестов
Все необходимые скрипты для запуска тестов прописаны в файле `package.json` в корне проекта. Для их выполнения используется Node.js окружение:

1. **Запуск всех e2e-тестов (во всех эмулируемых браузерах):**
   ```bash
   npm run test:e2e
   # (или напрямую: npx playwright test --config=tests/e2e/playwright.config.ts)
   ```
2. **Запуск тестов чата (основной пайплайн):**
   ```bash
   npm run test:e2e:chat
   # (или напрямую: npx playwright test tests/e2e/chat-pipeline.spec.ts --config=tests/e2e/playwright.config.ts)
   ```
3. **Запуск тестов в интерактивном режиме с отображением браузера (Headed Mode):**
   ```bash
   npm run test:e2e:ui
   # (или напрямую: npx playwright test tests/e2e/chat-pipeline.spec.ts --config=tests/e2e/playwright.config.ts --headed)
   ```
4. **Запуск тестов в режиме Playwright UI (удобный интерфейс для отладки):**
   ```bash
   npx playwright test --ui
   ```

---
*Отчет составлен Explorer суб-агентом (Инстанс 3).*

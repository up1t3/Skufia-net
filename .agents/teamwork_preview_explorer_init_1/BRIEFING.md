# BRIEFING — 2026-05-24T12:22:00Z

## Mission
Провести подробное read-only исследование кодовой базы мессенджера SKUFenger (фронтенд-архитектура, темы, адаптивность, мобильное поведение, E2E тесты) и подготовить детальный отчет с вехами разработки.

## 🔒 My Identity
- Archetype: Teamwork explorer
- Roles: Read-only investigator, analyzer
- Working directory: e:\Skufia-net\.agents\teamwork_preview_explorer_init_1
- Original parent: 28da9063-76ef-4155-9473-f67fa486cf2c (a7d115e4-38b9-4430-9132-abdbfff6d85a)
- Milestone: Initial exploration and frontend architecture analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Все отчеты и документация должны быть исключительно на русском языке
- Использовать Git Bash через PowerShell для выполнения консольных команд при необходимости
- Писать только в свою папку `.agents/teamwork_preview_explorer_init_1/`

## Current Parent
- Conversation ID: 28da9063-76ef-4155-9473-f67fa486cf2c (caller ID: a7d115e4-38b9-4430-9132-abdbfff6d85a)
- Updated: 2026-05-24T12:22:00Z

## Investigation State
- **Explored paths**: `frontend/index.html`, `frontend/messenger.html`, `frontend/chat.css`, `frontend/style-modal.css`, `frontend/style.css`, `frontend/messenger_app.js`, `frontend/chat_core.js`, `tests/e2e/` (playwright.config.ts, chat-pipeline.spec.ts, mobile-rtc.spec.ts, auth.spec.ts, chat-media.spec.ts)
- **Key findings**:
  - Фронтенд построен на чистом JS в виде SPA с набором модалок, оверлеев и вьюх (view-messages, view-forum, и т.д.).
  - Темы оформления используют единый набор CSS-переменных, меняющихся через дата-атрибуты `[data-theme]`. Всего 5 тем (cyber, telegram, neon, light-ios, gold).
  - Согласие с ФЗ-152 реализовано в виде чекбокса `#reg-pd-consent`, блокирующего кнопку отправки формы регистрации. Ссылка на ФЗ-152 отсутствует.
  - Контекстные меню сообщений вешаются на событие `click` бабла сообщения, в то время как браузерный `contextmenu` предотвращается. Это ломает выделение текста и нативный UX.
  - Вложения реализованы через модальное окно предпросмотра `#media-preview-modal` и загружаются асинхронно через `/api/chat/upload_multiple`. Клиентской валидации по типам файлов (например, .exe) перед отправкой на бэкенд не реализовано, что является риском безопасности.
  - Мобильная адаптивность построена на медиа-запросах (сдвиг сайдбара с помощью класса `chat-open`, отображение `mobile-back-btn`).
  - Клавиатура на мобилках обрабатывается через `window.visualViewport` в `messenger_app.js` для динамической корректировки `--app-height`, `--app-offset` и плавной прокрутки чата.
  - Тесты написаны на Playwright и имеют проблемы из-за захардкоженных URL-адресов (`https://skuf-net.ru` и `http://localhost:8007`) и устаревших селекторов в `chat-media.spec.ts`, что приводит к их падению в локальной и изолированной среде.
- **Unexplored areas**: Backend API routes, WebSocket event details, database structure in db.js, WebRTC logic in rtcManager.js

## Key Decisions Made
- Решено запускать E2E тесты точечно или только для проекта "Desktop Chrome", так как последовательный запуск всех тестов в 3 проектах занимает значительное время.

## Artifact Index
- `original_prompt.md` — Исходное задание
- `BRIEFING.md` — Текущее состояние и ограничения исследования
- `progress.md` — Лог прогресса исследования
- `handoff.md` — Итоговый отчет об исследовании

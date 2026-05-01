# Skufenger Standalone Refactoring

### 1. Стабилизация интеграционных тестов Backend (Выполнено)
- [x] Диагностика ошибок 404 и 422 в `test_chat_api.py`.
- [x] Исправление `conftest.py` для корректного внедрения зависимостей БД (замена `app.dependency_overrides` на правильные пути к роутерам `chat` и `registry`).
- [x] Добавление `X-Idempotency-Key` (через генерацию `uuid.uuid4().hex`) во все POST-запросы тестов чата и профиля.
- [x] Обновление схемы `MessageCreate` для валидации пустых или слишком длинных сообщений (`min_length=1`, `max_length=4096`).
- [x] Корректировка ожидаемых статус-кодов (415 для пустых файлов, 422 для пустых текстовых сообщений) в `test_chat_api.py`.
- [x] Успешное прохождение полного набора тестов (`pytest tests/backend/integration/test_chat_api.py`).

### 2. Исправление багов WebRTC звонков
- [/] Проанализировать `frontend/js/webrtc.js` на предмет обработки `call_accepted` и создания `remoteDescription`.
- [ ] Исправить проблему зависания интерфейса "Ожидание" у звонящего после ответа.
- [ ] Добавить корректную обработку медиа-треков (убедиться в вызове `.play()` для аудио/видео).
- [ ] Реализовать функцию переворота камеры (Flip Camera) без обрыва WebRTC соединения.
- [ ] Проверить корректность сброса стейтов (освобождение камеры, закрытие peerConnection) при завершении звонка.

### 3. Инструкции PWA для iOS
- [ ] Проверить метатеги `apple-touch-icon` в `index.html`.
- [ ] Подготовить короткое руководство пользователя по PWA.

### 4. Standalone Mode Refactoring
- [ ] Analyze `skufenger.html` and `manifest-skufenger.json`.
- [ ] Extract Messenger HTML from `index.html`.
- [ ] Implement `skufenger.html` (or `messenger.html`) with standalone UI structure.
- [ ] Create `messenger_app.js` logic for standalone initialization.
- [ ] Update `app.js` to remove redundant standalone hacks.
- [ ] Deploy and verify the standalone mode works cleanly without ecosystem elements.

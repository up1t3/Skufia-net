# 🧠 Skufia-Net 3.0: Enterprise Architecture & Mind Map

> [!IMPORTANT]
> **Это Единый источник истины (Single Source of Truth) для всех разработчиков, AI-агентов и инженеров.**
> Любые новые эндпоинты или таблицы перед написанием кода **ДОЛЖНЫ** быть занесены в этот список. Данная архитектура спроектирована под масштаб Enterprise и рассчитана на распределенные команды (DBA, Backend, Frontend).

## 1. 📂 Структура системы (Docker & Infra)
- **Frontend (Nginx / CDN):** Порт `5551`. Монтируется директория `/frontend` (PWA Messenger, CSS-стили, IndexedDB Offline Cache, *ServiceWorker для WebPush*).
- **Backend Node (FastAPI):** Порт `8007`. Горизонтально масштабируемое API. Роутинг Socket-событий осуществляется через **Redis Pub/Sub**, что позволяет поднимать любое количество API-нод за Load Balancer-ом.
- **Database (PostgreSQL 16):** Топология Persistent Volume. База спроектирована под высокие нагрузки с партицированием таблиц History и JSONB GIN-индексами.
- **Task Broker (Celery & Redis):** Воркеры используются для фоновых, блокирующих и отложенных задач (Blurhash генерация, Scheduled Messages, FCM Push-алерты, TTL-очистка ключей).
- **Media Storage (S3-Ready):** `/uploads`. Миграция на S3 API (MinIO) для хранения статики (Voice/Video/Картинки).

---

## 2. 🗄️ База Данных (PostgreSQL LLD)

### Ядро (Core)
- `User` (`id`, `username`, `email`, `public_key`, `push_tokens` (FCM/WebPush), `last_seen` (Redis Cache)).
- `Profile` — Мета-теги, статус онлайна.

### Мессенджер (Enterprise Chat)
- `ChatRoom` (`id`, `name`, `room_type`, `invite_code`) — Комнаты чата (Private / Group).
- `ChatRoomMember` (`id`, `room_id`, `user_id`, `role`, `unread_count`, `last_read_message_id`) — Роли, денормализованный счетчик непрочитанных.
- `Message` (Партицируемая таблица `PARTITION BY RANGE(created_at)`)
  - База: (`id` (Sequence BIGINT), `client_msg_id` (Idempotency Key), `sender_id`, `room_id`, `created_at`).
  - Контент: (`encrypted_content`, `file_url`, `encryption_iv`, `media_blurhash`, `media_width`, `media_height`).
  - Состояния: (`reply_to_id`, `forwarded_from_id`, `is_edited`, `is_deleted_for_all`, `reactions` (JSONB GIN), `ttl_seconds`).

### Барахолка (Marketplace)
- `MarketListing` (`id`, `title`, `price`, `description`, `category`, `status`, `views_count`, `seller_id`) — Карточки лотов.
- `MarketImage` (`id`, `listing_id`, `image_url`) — Галерея (До 3-х фото на лот).
- `Favorite` (`id`, `user_id`, `listing_id`) — Лайки/Избранное.

---

## 3. 🌐 REST API Роуты (Backend Endpoints)

Все методы доступны **и по префиксу `/api/...` и без него**. СТРОГО: Мутации требуют HTTP Header `X-Idempotency-Key` (UUID) для предотвращения дублей запросов от клиента с плохим 4G-соединением.

### Группы и Мессенджер (Chat)
- `GET /chat/rooms` — Получить список чатов (включает последнее сообщение).
- `GET /chat/rooms/{room_id}/messages` — **Keyset Pagination** (курсор `message_id`, никаких `OFFSET`).
- `POST /chat/rooms/{room_id}/messages` — Отправка сообщения. Триггерит Celery для рассылки Push-уведомлений оффлайн-клиентам.
- `PUT /chat/messages/{message_id}` — Редактирование (меняет `is_edited=true`).
- `DELETE /chat/messages/{message_id}` — Удаление (Soft delete, `is_deleted_for_all=true`).
- `POST /chat/messages/{message_id}/react` — Тело: `{"emoji": "🔥"}`. Мутация JSONB колонки `reactions`.
- **Группы и Инвайты:**
  - `POST /chat/rooms/create` — Тело: `{"name": "...", "room_type": "group"}`. Возвращает `invite_code`.
  - `GET /chat/rooms/{room_id}/members` — Отдает `invite_code`, `my_role`, и массив `members`.
  - `GET /chat/join/{invite_code}` — Присоединяет юзера к группе.
  - `DELETE /chat/rooms/{room_id}/members/{user_id}` — Мягкое удаление (Kick).
- **Загрузка Файлов (Media Pipeline):**
  - `POST /chat/upload_audio` — Принимает `.webm`. Celery генерирует Waveform.
  - `POST /chat/upload` — Принимает картинки/видео. Celery генерирует BlurHash для placeholder-рендеринга без Layout Shift (повышает метрику CLS).

### Барахолка (Marketplace)
- `GET /market` — Листинг всех товаров.
- `POST /market` — Создать объявление.
- `DELETE /market/{id}` — Удалить лот.
- `POST /market/upload` — Залить фото к лоту. Привязка к `listing_id`.
- `GET /market/recommended` — Умная рекомендательная заглушка.
- `POST /market/{id}/favorite` / `DELETE /market/{id}/favorite` — Добавить/Убрать из избранного.

### WebSocket (Async Push Transport)
- `ws://host:8007/ws/chat?token={jwt}` — Мультиплексор для чатов. 
- **Спецификация Payload (Events):**
  - `MSG_NEW`: Новое сообщение (полный JSON объект).
  - `MSG_EDIT` / `MSG_DEL`: Мутации существующих сообщений.
  - `MSG_REACTION`: Изменение JSONB `reactions`. Транслируется через Redis Pub/Sub на все ноды.
  - `READ_ACK`: Синхронизация Waterline прочтения. Тотчас триггерит Celery TTL-воркер (если сообщение удаляющееся).
  - `IS_TYPING`: Сигнал набора текста (`action: typing/audio/video`). Отменяется фронтендом либо TTL брокером через 3с.

---

## 4. 🧠 Зоны Риска и Недоработки (To-Do & Enterprise Gaps)

1. **E2EE (Сквозное шифрование):** Переход на **Double Ratchet Mechanism** (спецификация Signal). Ключи `Curve25519` генерируются на клиенте через `WebCrypto API`, `Shared Secret` обновляется при каждом запросе (Forward Secrecy). Монолитный `public_key` более не жизнеспособен; сервер выступает только как Data-транспорт.
2. **Offline-First (IndexedDB):** Frontend полностью отказывается от блокирующего ожидания ответов HTTP для ускорения UI. Оптимистичные апдейты (`is_sending: true`) в локальную `Dexie.js`. Разрешение Split-Brain конфликтов между несколькими устройствами обеспечивается механизмом HLC (Hybrid Logical Clocks).
3. **Производительность UI:** В чатах с 10,000+ сообщениями необходим **Virtual Viewport (Intersection Observer)**. Элементы, скрытые за Viewport, физически удаляются из DOM дерева с подменой на пустые `div` (запоминающие высоту), во избежание утечек оперативной памяти на мобильных устройствах.
4. **Push-уведомления (Offline):** Требуется интеграция `FCM (Firebase Cloud Messaging)` и `WebPush API` через кастомный Service Worker. Celery формирует зашифрованные VAPID-пакеты.
5. **Инфраструктура Звонков (WebRTC):** Интеграция TURN сервера (Coturn) для маршрутизации медиа-трафика (если симметричный NAT блокирует P2P). При групповых звонках требуется SFU-сервер (Selective Forwarding Unit — Twilio Video / Mediasoup) для минимизации CPU-load на десктопах участников.

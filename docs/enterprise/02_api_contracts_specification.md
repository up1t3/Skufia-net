# ТОМ 2: Контракты API и WebSockets (Transport Layer Low-Level Design)
**Разработчик:** AI API Architect | **Статус:** Утверждено | **Формат:** OpenAPI 3.1 & AsyncAPI 2.6

Данный документ описывает протоколы взаимодействия между Frontend (Browser/PWA) и Backend (FastAPI). Спецификация является жесткой: любое отклонение от структуры JSON приведет к ошибке 422 Unprocessable Entity.

---

## 1. REST API Конвенции (Synchronous Transport)

### 1.1 Заголовки (Headers) и Авторизация
*Все REST-запросы (кроме `/auth`) требуют валидного JWT.*
```http
Authorization: Bearer eyJhbG...
X-Idempotency-Key: 123e4567-e89b-12d3... (Обязательно для POST/PUT мутаций)
X-Client-Version: 3.1.0
```

### 1.2 Матрица HTTP-ошибок (Error Handling)
Сервер никогда не возвращает голый StackTrace или простую строку. Все ошибки оборачиваются в Envelope-формат.
```json
// Пример Response (Status: 400 Bad Request)
{
  "error": {
    "code": "MSG_DUPLICATE_IDEMPOTENCY",
    "message": "Message with this client_msg_id already processed.",
    "details": {"client_msg_id": "123e4567..."}
  }
}
```
| HTTP Status | Application Error Code | Условие возникновения |
| :--- | :--- | :--- |
| **401** | `TOKEN_EXPIRED` | JWT токен истек. Требуется запрос к `/auth/refresh`. |
| **403** | `ROOM_ACCESS_DENIED` | Попытка отправить сообщение в канал, где юзер ReadOnly. |
| **404** | `ENTITY_NOT_FOUND` | Сообщение, которое пытаются отредактировать, не найдено. |
| **409** | `CONFLICT_STATE` | Попытка поставить реакцию на уже удаленное сообщение. |
| **429** | `RATE_LIMIT_EXCEEDED` | Более 20 сообщений в секунду (Spam Protection). |

---

## 2. Ключевые REST Эндпоинты (Data Fetching & Mutation)

### 2.1 Отправка сообщения (POST `/api/v1/rooms/{room_id}/messages`)
*Идемпотентный эндпоинт для бизнес-логики отправки. Реальная доставка другим юзерам происходит через WebSocket.*

**Request Body (JSON):**
```json
{
  "client_msg_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "encrypted_content": "U2FsdGVkX1+z+8P...", // AES-256 E2EE Payload
  "reply_to_id": null,
  "forwarded_from_id": null,
  "media_attachments": [
    {
      "bucket_key": "s3://media/uuid.jpg",
      "type": "image",
      "blur_hash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      "width": 1920,
      "height": 1080
    }
  ],
  "ttl_seconds": null 
}
```
**Response (200 OK):** *(Возвращаем серверные метки времени)*
```json
{
  "id": "e2f1...", // Server DB ID
  "client_msg_id": "9b1deb4d...",
  "created_at": "2026-05-01T15:00:00.123Z",
  "status": "sent"
}
```

### 2.2 Получение истории с пагинацией (GET `/api/v1/rooms/{room_id}/messages`)
*Используется Keyset Cursor для загрузки старых сообщений при скролле вверх. Никаких `?page=2`.*

**Query Parameters:**
*   `cursor_id` (UUID, опционально) - ID самого старого сообщения на экране.
*   `cursor_time` (ISO8601, опционально) - Время `created_at` самого старого сообщения.
*   `limit` (INT, default: 50, max: 100).

**Response (200 OK):**
```json
{
  "data": [ { ...message_object_1 }, { ...message_object_50 } ],
  "meta": {
    "has_more": true,
    "next_cursor_id": "a1b2...",
    "next_cursor_time": "2026-04-30T10:00:00Z"
  }
}
```

### 2.3 Получение списка комнат и хронологическая сортировка (GET `/api/v1/rooms`)
*Возвращает список доступных комнат. По умолчанию применяется строгая хронологическая сортировка: комнаты отсортированы по убыванию даты последнего сообщения (`last_activity`), а затем по дате создания.*

**Response (200 OK):**
```json
{
  "rooms": [
    {
      "id": "room_1",
      "type": "private",
      "last_activity": "2026-05-01T15:00:00.123Z",
      ...
    }
  ]
}
```

### 2.4 Управление папками чатов (Система папок)
*Позволяет группировать контакты и комнаты в кастомные вкладки-папки, аналогично Telegram.*

#### Создание папки (POST `/api/v1/folders`)
**Request Body (JSON):**
```json
{
  "title": "Работа",
  "rooms": ["room_uuid_1", "room_uuid_2"] // Список ID комнат
}
```

#### Получение папок (GET `/api/v1/folders`)
**Response (200 OK):**
```json
{
  "folders": [
    {
      "id": "folder_uuid",
      "title": "Работа",
      "order_index": 0,
      "rooms": ["room_uuid_1", "room_uuid_2"]
    }
  ]
}
```

---

## 3. WebSockets Контракт (Real-Time Push Transport)

WebSocket-канал используется СТРОГО для **нисходящего (Сервер -> Клиент)** Push-потока. Клиент НЕ отправляет сообщения (текст) через WebSocket (чтобы работали HTTP-ретраи и загрузка медиа через Multipart/S3). Исключение — пинги и typing indicators.

*URL Подключения:* `wss://api.skufenger.net/ws/stream?token=JWT_TOKEN`

### 3.1 Жизненный цикл и Ping/Pong
Если клиент не получает PING от сервера в течение 40 секунд, он обязан закрыть сокет и сделать Reconnect с Экспоненциальной Задержкой (2s, 4s, 8s, 16s).

### 3.2 Async Push Events (Payload Framework)
Входящие сообщения по WS всегда имеют строгую Envelope-структуру.

#### Событие: Новое сообщение (`MSG_NEW`)
```json
{
  "type": "MSG_NEW",
  "room_id": "room_123",
  "payload": {
    "id": "msg_456",
    "client_msg_id": "client_abc",
    "sender_id": "user_789",
    "encrypted_content": "...AES...",
    "created_at": "2026-05-01T15:00Z"
  }
}
```

#### Событие: Обновление реакций (`MSG_REACTION`)
*UI мгновенно обновляет счетчик, не перезапрашивая текст.*
```json
{
  "type": "MSG_REACTION",
  "room_id": "room_123",
  "payload": {
    "message_id": "msg_456",
    "reactions": { "🔥": ["user_789", "user_111"] }
  }
}
```

#### Событие: Пользователь печатает (`IS_TYPING`)
*Клиент должен очистить этот статус через 3 секунды, если не получил нового ивента.*
```json
{
  "type": "IS_TYPING",
  "room_id": "room_123",
  "payload": {
    "user_id": "user_789",
    "action": "typing" // Может быть: "typing", "recording_video", "recording_audio"
  }
}
```

#### Событие: Синхронизация Прочтения (`READ_ACK`)
*Сдвигает Waterline ("галочки" синеют). Приходит всем участникам комнаты.*
```json
{
  "type": "READ_ACK",
  "room_id": "room_123",
  "payload": {
    "user_id": "user_789",
    "last_read_message_id": "msg_400"
  }
}
```

---
*Конец Тома 2.*

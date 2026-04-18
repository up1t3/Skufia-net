# 🧠 Skufia-Net 2.0: Architecture & Mind Map

> [!IMPORTANT]
> **Это Единый источник истины (Single Source of Truth) для всех AI-агентов и инженеров.**
> Любые новые эндпоинты или таблицы перед написанием кода **ДОЛЖНЫ** быть занесены в этот список, чтобы избежать галлюцинаций (как это произошло на Фазе 3 с несуществующим методом).

## 1. 📂 Структура системы (Docker)
- **Frontend (Nginx):** Порт `5551`. Монтируется директория `/frontend` (PWA Messenger, CSS-стили Stitch, ServiceWorker).
- **Backend (FastAPI):** Порт `8007`. Работает через `uvicorn`.
- **Database (SQLite):** `/data/skufia.db`. Persistent Docker Volume `skufia_db`.
- **Media (Uploads):** `/uploads`. Persistent Docker Volume `skufia_uploads`.

---

## 2. 🗄️ База Данных (Database Schema)

### Ядро (Core)
- `User` (`id`, `username`, `email`, `public_key`) — Пользователи системы.
- `Profile` — Мета-теги, статус онлайна.

### Мессенджер (Chat)
- `ChatRoom` (`id`, `name`, `room_type`, `invite_code`) — Комнаты чата (Private / Group).
- `ChatRoomMember` (`id`, `room_id`, `user_id`, `role`) — Участники групп. Роли: `admin`, `member`.
- `Message` (`id`, `sender_id`, `room_id`, `content`, `file_url`, `encryption_iv`, `reply_to_id`, `is_edited`).

### Барахолка (Marketplace)
- `MarketListing` (`id`, `title`, `price`, `description`, `category`, `status`, `views_count`, `seller_id`) — Карточки лотов.
- `MarketImage` (`id`, `listing_id`, `image_url`) — Галерея (До 3-х фото на лот).
- `Favorite` (`id`, `user_id`, `listing_id`) — Лайки/Избранное.

---

## 3. 🌐 REST API Роуты (Backend Endpoints)

Все методы доступны **и по префиксу `/api/...` и без него (по `/...`)**, так как роутер монтируется дважды.

### Группы и Мессенджер (Chat)
- `GET /chat/rooms` — Получить список чатов текущего пользователя.
- `GET /chat/rooms/{room_id}/history` — Подгрузить старые сообщения.
- `POST /chat/rooms/{room_id}/send` — Отправить системное сообщение или перехват ботов (например, `@baza`).
- **Группы и Инвайты:**
  - `POST /chat/rooms/create` — Тело: `{"name": "...", "room_type": "group"}`. Создает группу. Возвращает `invite_code`.
  - `GET /chat/rooms/{room_id}/members` — Отдает `invite_code`, `my_role`, и массив `members` (user_id, display_name, role).
  - `GET /chat/join/{invite_code}` — Присоединяет юзера к группе.
  - `DELETE /chat/rooms/{room_id}/members/{user_id}` — Мягкое удаление (Kick), работает только если вызывающий — `admin`.
- **Загрузка Файлов:**
  - `POST /chat/upload_audio` — Принимает `.webm` из MediaRecorder, ограничение 10 МБ.
  - `POST /chat/upload` — Принимает другие файлы, ограничение 5 МБ.

### Барахолка (Marketplace)
- `GET /market` — Листинг всех товаров (с фильтрами `category`, `location`).
- `POST /market` — Создать объявление.
- `DELETE /market/{id}` — Удалить лот (владелец или админ).
- `POST /market/upload` — Залить фото к лоту. Привязка к `listing_id`.
- `GET /market/recommended` — Умная рекомендательная заглушка.
- `GET /market/{id}/favorite` / `DELETE /market/{id}/favorite` — Добавить или убрать из избранного.

### WebSocket (Realtime)
- `ws://host:8007/ws/chat?token={jwt}` — Мультиплексор для чатов. 
  - Форматы payload: `new_message`, `edit_message`, `delete_message`.

---

## 4. 🧠 Зоны Риска и Недоработки (To-Do)
1. E2EE (Сквозное шифрование): В базе есть `encryption_iv` и `public_key`, но валидный обмен ключами Диффи-Хеллмана на фронтенде не доведен до конца. Ключи просто прокидываются.
2. ИИ-Бот: `@baza` пока является "заглушкой на перекуре". Нужна интеграция LLM-провайдера (Ollama/OpenRouter).

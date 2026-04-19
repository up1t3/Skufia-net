# ТОМ 1: Архитектура Баз Данных (Database Low-Level Design) - ИСПРАВЛЕНА ПОСЛЕ АУДИТА
**Разработчик:** AI DBA Agent | **Статус:** Утверждено | **Версия СУБД:** PostgreSQL 16+

Данный документ содержит строгий DDL-контракт. В результате внутреннего аудита устранены антипаттерны High-Load систем (например, блокировки при подсчете непрочитанных сообщений и write-amplification).

---

## 1. Конвенции и Настройки БД (PostgreSQL)

### 1.1 Глобальные настройки и Idempotency (Защита от дублей)
*   Генерация ID через `uuid-ossp`. 
*   **Идемпотентность:** Клиент работает в оффлайне, при отправке сообщения он сам генерирует `client_msg_id` (UUIDv4). Сервер использует его для дедупликации (если пользователь проехал в туннеле и телефон послал запрос дважды, сервер проигнорирует второй благодаря Constraints).

### 1.2 Стратегия Индексирования и Пагинации
Использование классического `OFFSET` запрещено. Пагинация строится строго по курсору (Keyset Pagination) через проверку `(created_at, id) > (cursor_time, cursor_id)`.

---

## 2. Физическая Схема Данных (SQL DDL)

### 2.1 Таблица `users` (Профили и Безопасность)
*Правка аудита: Частые обновления (онлайн/офлайн) убивают PostgreSQL (Write Amplification). Поле `last_seen` убрано из SQL — оно живет в оперативной памяти (Redis).*

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(32) UNIQUE NOT NULL,
    phone_number VARCHAR(20) UNIQUE NULL, -- Для Telegram-подобной авторизации
    password_hash VARCHAR(255) NULL, -- NULL, если вход по SMS-коду
    
    -- Безопасность и 2FA
    is_2fa_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255) NULL,
    
    -- Криптографические артефакты E2EE
    public_identity_key VARCHAR(128) NOT NULL,
    signed_prekey VARCHAR(512) NOT NULL,
    
    push_tokens JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 Таблица `rooms` и `room_members` (Денормализация)
*Правка аудита: Делать `COUNT()` для получения "количества непрочитанных" недопустимо в Enterprise. Вводим денормализованный счетчик `unread_count`.*

```sql
CREATE TYPE room_type_enum AS ENUM ('direct', 'group', 'channel');

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NULL, 
    type room_type_enum NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE room_members (
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    
    -- Waterline (Где остановился пользователь)
    last_read_message_id UUID NULL, 
    
    -- ДЕНОРМАЛИЗАЦИЯ: Кешированный счетчик для быстрого рендера списка чатов (Sidebar)
    unread_count INT DEFAULT 0,
    
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_room_members_user_unread ON room_members(user_id, unread_count);
```

### 2.3 Таблица `messages` (Ядро системы)
*Правка аудита: Добавлен `client_msg_id` для защиты от дублирования при плохом Edge/3G интернете.*

```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_msg_id UUID UNIQUE NOT NULL, -- Ключ идемпотентности от Frontend
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    
    -- Payload
    encrypted_content TEXT NOT NULL, 
    
    -- Механизм пересылки и ответов
    reply_to_id UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
    forwarded_from_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reactions JSONB DEFAULT '{}'::jsonb,
    
    -- Флаги состояний
    is_edited BOOLEAN DEFAULT FALSE,
    is_deleted_for_all BOOLEAN DEFAULT FALSE,
    
    -- Планировщик (Celery / ARQ)
    scheduled_at TIMESTAMP WITH TIME ZONE NULL, 
    ttl_seconds INT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Критический Индекс для скролла чата (Keyset Pagination)
CREATE INDEX idx_messages_room_pagination ON messages (room_id, created_at DESC, id DESC);
```

### 2.4 Таблица `media_attachments` (Анти-джиттер UI)
*Правка аудита: Добавлены ширина и высота картинки. Иначе UI интерфейс "прыгает" при загрузке картинок (Layout Shift).*

```sql
CREATE TYPE media_type_enum AS ENUM ('image', 'video', 'voice', 'file', 'lottie_sticker');

CREATE TABLE media_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    type media_type_enum NOT NULL,
    
    bucket_key VARCHAR(512) NOT NULL, 
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    
    -- МЕТАДАННЫЕ: Критично для Frontend-рендеринга без скачков (CLS - Cumulative Layout Shift)
    width INT NULL,
    height INT NULL,
    duration_seconds INT NULL, -- Для видео и voice
    
    blur_hash VARCHAR(64) NULL,
    waveform JSONB NULL, 
    is_encrypted BOOLEAN DEFAULT TRUE
);
```

---

## 3. Масштабирование (Database Sharding Strategy)
*Правка аудита: Партиционирование только по месяцам убивает скорость выборки чата.*
Мы используем **Composite Partitioning**: 
Сначала таблица `messages` делится по `Hash(room_id)` на 100 шардов (чтобы вся история одного чата гарантированно лежала на одном диске/сервере). Внутри хэш-шарда применяется Range Partitioning по месяцам (`created_at`) для быстрой архивации старых данных в холодное хранилище (S3/Glacier).

---
*Конец Тома 1.*

from fastapi import FastAPI, status
import seed_everything
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, SessionLocal, Profile, DATABASE_URL
from routers.wiki import router as wiki_router
from routers.forum import router as forum_router
from routers.registry import router as registry_router
from routers.chat import router as chat_router
from routers.notifications import router as notifications_router
from routers.market import router as market_router
from routers.events import router as events_router
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import asyncio
from broadcaster import Broadcast
import os
import datetime
from sqlalchemy import func

import redis.asyncio as aioredis

redis_client = aioredis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"), decode_responses=True)

from auth import decode_token, router as auth_router
from rate_limit import check_rate_limit
try:
    from telegram_bot import run_bot
except ImportError:
    run_bot = None

from monitoring import setup_metrics, ACTIVE_WEBSOCKETS

from sqlalchemy import inspect, text
from database import engine, Base, DATABASE_URL

# --- Database Migration (add missing columns to existing DB) ---
def run_migrations():
    """Add columns that may be missing from older schema versions, database-agnostic."""
    try:
        inspector = inspect(engine)
        
        with engine.begin() as conn:
            # Helper to check if column exists
            def column_exists(table_name, column_name):
                if not inspector.has_table(table_name):
                    return False
                cols = [col['name'] for col in inspector.get_columns(table_name)]
                return column_name in cols
                
            # Helper to add column
            def add_column(table_name, column_name, column_type, default=""):
                if not column_exists(table_name, column_name):
                    default_clause = f" DEFAULT {default}" if default else ""
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}{default_clause}"))
                    print(f"MIGRATION: Added '{column_name}' column to {table_name} table.")

            # users
            add_column("users", "public_key", "TEXT")
            add_column("users", "encrypted_private_key", "TEXT")
            add_column("users", "handle", "VARCHAR")
            add_column("users", "is_superadmin", "BOOLEAN", default="0" if DATABASE_URL.startswith("sqlite") else "FALSE")
            add_column("users", "recovery_email", "VARCHAR")
            add_column("users", "phone_number", "VARCHAR")
            add_column("users", "accepted_pd", "BOOLEAN", default="0" if DATABASE_URL.startswith("sqlite") else "FALSE")
            
            # messages
            add_column("messages", "encryption_iv", "TEXT")
            add_column("messages", "file_url", "TEXT")
            add_column("messages", "reply_to_id", "INTEGER")
            add_column("messages", "is_edited", "BOOLEAN", default="0" if DATABASE_URL.startswith("sqlite") else "FALSE")
            add_column("messages", "is_deleted_for_all", "BOOLEAN", default="0" if DATABASE_URL.startswith("sqlite") else "FALSE")
            add_column("messages", "ttl_seconds", "INTEGER")
            # postgres requires valid json literal for default '{}', sqlite takes '{}'
            add_column("messages", "reactions", "JSON", default="'{}'")
            
            # chat_rooms
            add_column("chat_rooms", "invite_code", "TEXT")
            
            # chat_room_members
            add_column("chat_room_members", "role", "VARCHAR" if DATABASE_URL.startswith("postgres") else "TEXT", default="'member'")
            add_column("chat_room_members", "unread_count", "INTEGER", default="0")
            
            # Ensure push_tokens table exists for raw SQL access before Base.metadata.create_all
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS push_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                token VARCHAR NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """ if getattr(engine.dialect, 'name', '') == 'postgresql' else """
            CREATE TABLE IF NOT EXISTS push_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                token VARCHAR NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """))

            # profiles
            add_column("profiles", "nickname", "VARCHAR")
            
            # market_listings
            add_column("market_listings", "status", "VARCHAR", default="'active'")
            add_column("market_listings", "views_count", "INTEGER", default="0")
            add_column("market_listings", "updated_at", "TIMESTAMP" if getattr(engine.dialect, 'name', '') == 'postgresql' else "DATETIME")
            
    except Exception as e:
        print(f"MIGRATION WARNING: {e}")

# Always create tables from SQLAlchemy models
Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(
    title="Skufia API",
    description="Backend for the Skufia community portal - Cyber-Industrial Forum",
    version="0.1.0"
)

# Ensure uploads directory exists
os.makedirs("uploads", exist_ok=True)
os.makedirs(os.path.join("uploads", "voice"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="api_uploads")

from ws_manager import broadcast, manager

# --- CORS Configuration ---
setup_metrics(app)

# Allow requests from frontend (port 5551) and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5551",
        "http://127.0.0.1:5551",
        "http://localhost:8007",
        "http://127.0.0.1:8007",
        "https://skuf-net.ru",
        "https://xn--e1afmapc3af.xn--p1ai",
        "http://skuf-net.ru",
        "http://xn--e1afmapc3af.xn--p1ai"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Auth router
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# Mount Modular routers
app.include_router(wiki_router, prefix="/api", tags=["wiki"])
app.include_router(forum_router, prefix="/api", tags=["forum"])
app.include_router(registry_router, prefix="/api", tags=["registry"])
app.include_router(chat_router, prefix="/api", tags=["chat"])
app.include_router(notifications_router, prefix="/api", tags=["notifications"])
app.include_router(market_router, prefix="/api", tags=["market"])
app.include_router(events_router, prefix="/api", tags=["events"])

# --- WebSocket Manager ---
# Manager imported from ws_manager.py

@app.websocket("/ws/chat/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    try:
        user_data = decode_token(token)
        if not user_data:
            print(f"WS AUTH ERROR: decode_token returned None for token {token[:10]}...")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        user_id = user_data.get("user_id")
        if not user_id:
            print(f"WS AUTH ERROR: user_data has no user_id: {user_data}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception as e:
        print(f"WS AUTH ERROR Exception: {e}")
        await websocket.close(code=4003) # Unauthorized
        return

    await manager.connect(user_id, websocket)

    # Check for pending incoming calls
    try:
        from database import redis_client
        import json
        if redis_client:
            # redis_client is async
            keys = await redis_client.keys(f"rtc_offer:*:{user_id}")
            for key in keys:
                try:
                    # key might be bytes
                    key_str = key.decode('utf-8') if isinstance(key, bytes) else key
                    parts = key_str.split(":")
                    if len(parts) >= 3:
                        caller_id_str = parts[1]
                        offer_payload = await redis_client.get(key)
                        if offer_payload:
                            offer_msg = {
                                "type": "rtc_signal",
                                "sender_id": int(caller_id_str),
                                "signal_type": "offer",
                                "payload": json.loads(offer_payload)
                            }
                            await websocket.send_text(json.dumps(offer_msg))
                except Exception as e:
                    print(f"Failed to process pending call {key}: {e}")
    except Exception as e:
        print(f"Error fetching pending calls: {e}")

    async def receiver():
        try:
            while True:
                # We receive messages here for WebRTC signaling relay and other real-time events
                text_data = await websocket.receive_text()

                # Check rate limit (5 messages per second)
                if not await check_rate_limit(f"ws:{user_id}", limit=5, window=1):
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Rate limit exceeded")
                    return

                try:
                    data = json.loads(text_data)
                    msg_type = data.get('type')
                    if msg_type == 'rtc_signal':
                        target_id = data.get('target')
                        if target_id:
                            relay_msg = {
                                "type": "rtc_signal",
                                "sender_id": user_id,
                                "signal_type": data.get('signal_type'),
                                "payload": data.get('payload')
                            }
                            await manager.send_personal_message(relay_msg, target_id)
                            
                            if data.get('signal_type') == 'offer':
                                # Start 45s timeout for missed calls
                                call_key = f"{user_id}_{target_id}"
                                async def missed_call_timeout(u_id, t_id):
                                    await asyncio.sleep(45)
                                    call_key = f"rtc_offer:{u_id}:{t_id}"
                                    if await redis_client.exists(call_key):
                                        await redis_client.delete(call_key)
                                        cancel_msg = {"type": "rtc_signal", "sender_id": t_id, "signal_type": "end", "payload": None}
                                        await manager.send_personal_message(cancel_msg, u_id)
                                        await manager.send_personal_message(cancel_msg, t_id)
                                        db = SessionLocal()
                                        try:
                                            from database import Message, Room, RoomMember
                                            rooms_query = db.query(Room.id).filter(Room.type == 'private').join(RoomMember).filter(RoomMember.user_id.in_([u_id, t_id])).group_by(Room.id).having(func.count(Room.id) == 2).all()
                                            if rooms_query:
                                                r_id = rooms_query[0][0]
                                                msg = Message(room_id=r_id, sender_id=u_id, message_type='missed_call', content="Пропущенный вызов", created_at=datetime.datetime.utcnow())
                                                db.add(msg)
                                                db.commit()
                                                db.refresh(msg)
                                                from routers.chat import format_message
                                                msg_data = format_message(msg)
                                                await manager.send_personal_message({"type": "new_message", "message": msg_data}, u_id)
                                                await manager.send_personal_message({"type": "new_message", "message": msg_data}, t_id)
                                        except Exception as e:
                                            print(f"Missed call timeout error: {e}")
                                        finally:
                                            db.close()
                                
                                asyncio.create_task(missed_call_timeout(user_id, target_id))
                                
                                # Store offer in Redis with 45s expiration
                                call_key = f"rtc_offer:{user_id}:{target_id}"
                                import json
                                await redis_client.setex(call_key, 45, json.dumps(data.get('payload')))

                                # ALWAYS Trigger Web Push for calls to ensure background delivery
                                from ws_manager import trigger_web_push
                                db = SessionLocal()
                                from database import User
                                sender_user = db.query(User).filter(User.id == user_id).first()
                                sender_name = sender_user.profile.nickname if sender_user and sender_user.profile else "Пользователь"
                                db.close()
                                push_payload = {
                                    "title": f"Входящий видеозвонок",
                                    "body": f"Вам звонит {sender_name}. Нажмите, чтобы ответить.",
                                    "data": {"action": "call", "sender_id": user_id}
                                }
                                asyncio.create_task(trigger_web_push(target_id, push_payload, ttl=45, urgency="high"))
                                    
                            elif data.get('signal_type') == 'request_offer':
                                # Receiver is asking for the cached offer (after waking up from push)
                                call_key = f"rtc_offer:{target_id}:{user_id}" # caller is target_id, receiver is user_id
                                cached_offer_raw = await redis_client.get(call_key)
                                if cached_offer_raw:
                                    import json
                                    offer_msg = {
                                        "type": "rtc_signal",
                                        "sender_id": target_id,
                                        "signal_type": "offer",
                                        "payload": json.loads(cached_offer_raw)
                                    }
                                    await manager.send_personal_message(offer_msg, user_id)
                                        
                            elif data.get('signal_type') in ['answer', 'end', 'reject']:
                                call_key = f"rtc_offer:{target_id}:{user_id}"
                                await redis_client.delete(call_key)
                                
                                call_key_self = f"rtc_offer:{user_id}:{target_id}"
                                await redis_client.delete(call_key_self)
                    elif data.get('type') == 'typing_indicator':
                        target_id = data.get('target')
                        if target_id:
                            relay_msg = {
                                "type": "typing_indicator",
                                "sender_id": user_id,
                                "typing": data.get('typing', True)
                            }
                            await manager.send_personal_message(relay_msg, target_id)
                    elif data.get('type') == 'read_receipt':
                        target_id = data.get('target')
                        if target_id:
                            relay_msg = {
                                "type": "read_receipt",
                                "sender_id": user_id,
                                "message_id": data.get('message_id'),
                                "room_id": data.get('room_id')
                            }
                            await manager.send_personal_message(relay_msg, target_id)
                    elif msg_type == 'typing_status':
                        room_id = data.get('room_id')
                        if room_id:
                            db = SessionLocal()
                            from database import ChatRoomMember
                            members = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).all()
                            uids = [m.user_id for m in members if m.user_id != user_id]
                            db.close()
                            
                            relay_msg = {
                                "type": "typing_status",
                                "sender_id": user_id,
                                "room_id": room_id,
                                "is_typing": data.get('status', True)
                            }
                            await manager.broadcast_msg(relay_msg, user_ids=uids)
                    elif msg_type == 'read_ack':
                        message_id = data.get('message_id')
                        room_id = data.get('room_id')
                        if message_id:
                            db = SessionLocal()
                            from database import Message
                            msg = db.query(Message).filter(Message.id == message_id).first()
                            if msg and msg.sender_id != user_id:
                                msg.is_read = True
                                db.commit()
                                
                                relay_msg = {
                                    "type": "read_ack",
                                    "message_id": message_id,
                                    "room_id": msg.room_id,
                                    "reader_id": user_id
                                }
                                await manager.send_personal_message(relay_msg, msg.sender_id)
                            db.close()
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            pass

    async def sender(channel):
        async with broadcast.subscribe(channel) as subscriber:
            async for event in subscriber:
                try:
                    await websocket.send_text(event.message)
                except Exception:
                    break

    task_receiver = asyncio.create_task(receiver())
    task_sender_user = asyncio.create_task(sender(f"channel:{user_id}"))
    task_sender_global = asyncio.create_task(sender("channel:global"))

    try:
        done, pending = await asyncio.wait(
            [task_receiver, task_sender_user, task_sender_global],
            return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    finally:
        await manager.disconnect(user_id)

@app.on_event("startup")
async def startup_event():
    # Setup standard synchronous initialization if not done explicitly
    if not DATABASE_URL.startswith("sqlite"):
        Base.metadata.create_all(bind=engine)
            
    await broadcast.connect()
    print("Initializing Skufia Ecosystem... Checking for data seeds...")

    seed_everything.seed_data()
    print("System seeded successfully.")
    if run_bot:
        print("Starting Telegram Support Bot...")
        asyncio.create_task(run_bot())

    # Start audio/video file cleanup task (5-day TTL)
    asyncio.create_task(cleanup_media_files_task())

# [FIX-04] Removed duplicate include_router (already included at line 142 with prefix='/api')

async def cleanup_media_files_task():
    """Background task: delete voice and video files older than 5 days every 6 hours."""
    import time
    MEDIA_TTL_SECONDS = 5 * 24 * 60 * 60  # 5 days
    dirs_to_clean = [
        os.path.join("uploads", "voice"),
        os.path.join("uploads", "video")
    ]

    while True:
        try:
            now = time.time()
            total_deleted = 0
            for media_dir in dirs_to_clean:
                if os.path.isdir(media_dir):
                    deleted = 0
                    for fname in os.listdir(media_dir):
                        fpath = os.path.join(media_dir, fname)
                        if os.path.isfile(fpath):
                            age = now - os.path.getmtime(fpath)
                            if age > MEDIA_TTL_SECONDS:
                                try:
                                    os.remove(fpath)
                                    deleted += 1
                                except OSError as e:
                                    print(f"[MediaTTL] Failed to delete {fpath}: {e}")
                    if deleted:
                        print(f"[MediaTTL] Deleted {deleted} expired file(s) from {media_dir}.")
                    total_deleted += deleted
            if total_deleted == 0:
                pass # Nothing deleted
        except Exception as e:
            print(f"[MediaTTL] Cleanup error: {e}")
        # Run every 6 hours
        await asyncio.sleep(6 * 60 * 60)


@app.get("/", tags=["Health"])
async def root():
    return {"status": "online", "message": "Welcome to Skufia API"}


@app.on_event("shutdown")
async def shutdown_event():
    await broadcast.disconnect()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)

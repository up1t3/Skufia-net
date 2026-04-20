from fastapi import FastAPI, status
import seed_everything
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, SessionLocal, Profile, DATABASE_URL
from routes import router as main_router
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import asyncio
from broadcaster import Broadcast
import os
from auth import decode_token, router as auth_router
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

broadcast = Broadcast(os.environ.get("REDIS_URL", "redis://localhost:6379"))

# --- CORS Configuration ---
setup_metrics(app)

# Allow requests from frontend (port 5551) and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5551",
        "http://127.0.0.1:5551",
        "http://localhost:8007",
        "http://127.0.0.1:8007"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Auth router
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# Mount Main router (contains forum, registry, chat logic)
app.include_router(main_router, prefix="/api", tags=["main"])

# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        ACTIVE_WEBSOCKETS.inc()
        # Update online status
        db = SessionLocal()
        profile = db.query(Profile).filter(Profile.user_id == user_id).first()
        if profile:
            profile.is_online = True
            db.commit()
        db.close()

    async def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            ACTIVE_WEBSOCKETS.dec()
        # Update offline status
        db = SessionLocal()
        profile = db.query(Profile).filter(Profile.user_id == user_id).first()
        if profile:
            profile.is_online = False
            db.commit()
        db.close()

    async def send_personal_message(self, message: dict, user_id: int):
        await broadcast.publish(channel=f"channel:{user_id}", message=json.dumps(message))

    async def broadcast(self, message: dict, user_ids: List[int] = None):
        msg_str = json.dumps(message)
        if user_ids:
            for uid in user_ids:
                await broadcast.publish(channel=f"channel:{uid}", message=msg_str)
        else:
            await broadcast.publish(channel="channel:global", message=msg_str)

manager = ConnectionManager()

@app.websocket("/ws/chat/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    try:
        user_data = decode_token(token)
        user_id = user_data.get("user_id")
        if not user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=4003) # Unauthorized
        return

    await manager.connect(user_id, websocket)

    async def receiver():
        try:
            while True:
                # We receive messages here for WebRTC signaling relay and other real-time events
                text_data = await websocket.receive_text()
                try:
                    data = json.loads(text_data)
                    if data.get('type') == 'rtc_signal':
                        target_id = data.get('target')
                        if target_id:
                            relay_msg = {
                                "type": "rtc_signal",
                                "sender_id": user_id,
                                "signal_type": data.get('signal_type'),
                                "payload": data.get('payload')
                            }
                            await manager.send_personal_message(relay_msg, target_id)
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
# Include API routes (Forum, Market, Wiki, etc.)
app.include_router(main_router, tags=["API"])

@app.get("/", tags=["Health"])
async def root():
    return {"status": "online", "message": "Welcome to Skufia API"}


@app.on_event("shutdown")
async def shutdown_event():
    await broadcast.disconnect()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)

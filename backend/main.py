from fastapi import FastAPI, status
import seed_everything
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, SessionLocal, Profile
from routes import router as main_router
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import asyncio
from auth import decode_token, router as auth_router
try:
    from telegram_bot import run_bot
except ImportError:
    run_bot = None

from monitoring import setup_metrics, ACTIVE_WEBSOCKETS

# --- Database Migration (add missing columns to existing DB) ---
def run_migrations():
    """Add columns that may be missing from older schema versions."""
    import sqlite3
    db_path = 'skufia.db'
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check and add users.public_key
        cursor.execute("PRAGMA table_info(users)")
        user_cols = [row[1] for row in cursor.fetchall()]
        if 'public_key' not in user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN public_key TEXT")
            print("MIGRATION: Added 'public_key' column to users table.")
        
        # Check and add messages.encryption_iv
        cursor.execute("PRAGMA table_info(messages)")
        msg_cols = [row[1] for row in cursor.fetchall()]
        if 'encryption_iv' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN encryption_iv TEXT")
            print("MIGRATION: Added 'encryption_iv' column to messages table.")
        
        # Check and add messages.file_url
        if 'file_url' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN file_url TEXT")
            print("MIGRATION: Added 'file_url' column to messages table.")
            
        # Check and add messages.reply_to_id
        if 'reply_to_id' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER")
            print("MIGRATION: Added 'reply_to_id' column to messages table.")
            
        # Check and add messages.is_edited
        if 'is_edited' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN is_edited BOOLEAN DEFAULT 0")
            print("MIGRATION: Added 'is_edited' column to messages table.")

        # Check and add messages.is_deleted_for_all
        if 'is_deleted_for_all' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN is_deleted_for_all BOOLEAN DEFAULT 0")
            print("MIGRATION: Added 'is_deleted_for_all' column to messages table.")

        # Check and add messages.ttl_seconds
        if 'ttl_seconds' not in msg_cols:
            cursor.execute("ALTER TABLE messages ADD COLUMN ttl_seconds INTEGER")
            print("MIGRATION: Added 'ttl_seconds' column to messages table.")

        # Check and add chat_rooms.invite_code
        cursor.execute("PRAGMA table_info(chat_rooms)")
        room_cols = [row[1] for row in cursor.fetchall()]
        if 'invite_code' not in room_cols:
            cursor.execute("ALTER TABLE chat_rooms ADD COLUMN invite_code TEXT")
            print("MIGRATION: Added 'invite_code' column to chat_rooms table.")

        # Check and add chat_room_members.role
        cursor.execute("PRAGMA table_info(chat_room_members)")
        member_cols = [row[1] for row in cursor.fetchall()]
        if 'role' not in member_cols:
            cursor.execute("ALTER TABLE chat_room_members ADD COLUMN role TEXT DEFAULT 'member'")
            print("MIGRATION: Added 'role' column to chat_room_members table.")

        # Check and add profiles.nickname
        cursor.execute("PRAGMA table_info(profiles)")
        profile_cols = [row[1] for row in cursor.fetchall()]
        if 'nickname' not in profile_cols:
            cursor.execute("ALTER TABLE profiles ADD COLUMN nickname VARCHAR")
            print("MIGRATION: Added 'nickname' column to profiles table.")
            
        # Check and add chat_rooms.invite_code
        cursor.execute("PRAGMA table_info(chat_rooms)")
        room_cols = [row[1] for row in cursor.fetchall()]
        if 'invite_code' not in room_cols:
            cursor.execute("ALTER TABLE chat_rooms ADD COLUMN invite_code TEXT UNIQUE")
            print("MIGRATION: Added 'invite_code' column to chat_rooms table.")
            
        # Check and add chat_room_members.role
        cursor.execute("PRAGMA table_info(chat_room_members)")
        member_cols = [row[1] for row in cursor.fetchall()]
        if 'role' not in member_cols:
            cursor.execute("ALTER TABLE chat_room_members ADD COLUMN role TEXT DEFAULT 'member'")
            print("MIGRATION: Added 'role' column to chat_room_members table.")
        
        # Check and add market_listings new columns
        cursor.execute("PRAGMA table_info(market_listings)")
        market_listings_cols = [row[1] for row in cursor.fetchall()]
        if 'status' not in market_listings_cols:
            cursor.execute("ALTER TABLE market_listings ADD COLUMN status VARCHAR DEFAULT 'active'")
            print("MIGRATION: Added 'status' column to market_listings table.")
        if 'views_count' not in market_listings_cols:
            cursor.execute("ALTER TABLE market_listings ADD COLUMN views_count INTEGER DEFAULT 0")
            print("MIGRATION: Added 'views_count' column to market_listings table.")
        if 'updated_at' not in market_listings_cols:
            cursor.execute("ALTER TABLE market_listings ADD COLUMN updated_at DATETIME")
            print("MIGRATION: Added 'updated_at' column to market_listings table.")

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"MIGRATION WARNING: {e}")

run_migrations()

# Initialize database tables on startup (creates new tables, won't modify existing)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Skufia API",
    description="Backend for the Skufia community portal - Cyber-Industrial Forum",
    version="0.1.0"
)

# Ensure uploads directory exists
os.makedirs("uploads", exist_ok=True)
os.makedirs(os.path.join("uploads", "voice"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

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

    def disconnect(self, user_id: int):
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
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_text(json.dumps(message))

    async def broadcast(self, message: dict, user_ids: List[int] = None):
        msg_str = json.dumps(message)
        if user_ids:
            for uid in user_ids:
                if uid in self.active_connections:
                    await self.active_connections[uid].send_text(msg_str)
        else:
            for connection in self.active_connections.values():
                await connection.send_text(msg_str)

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
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(user_id)

@app.on_event("startup")
async def startup_event():
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)

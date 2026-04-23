from fastapi import WebSocket
from typing import Dict, List
import json
from broadcaster import Broadcast
import os
from database import SessionLocal, Profile
from monitoring import ACTIVE_WEBSOCKETS

broadcast = Broadcast(os.environ.get("REDIS_URL", "redis://localhost:6379"))

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

    async def broadcast_msg(self, message: dict, user_ids: List[int] = None):
        msg_str = json.dumps(message)
        if user_ids:
            for uid in user_ids:
                await broadcast.publish(channel=f"channel:{uid}", message=msg_str)
        else:
            await broadcast.publish(channel="channel:global", message=msg_str)

manager = ConnectionManager()

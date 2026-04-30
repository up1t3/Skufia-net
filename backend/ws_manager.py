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
        # Broadcast status asynchronously
        if profile:
            await notify_profile_update(user_id, {"is_online": True})

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
        # Broadcast status asynchronously
        if profile:
            await notify_profile_update(user_id, {"is_online": False})

    async def send_personal_message(self, message: dict, user_id: int):
        try:
            await broadcast.publish(channel=f"channel:{user_id}", message=json.dumps(message))
        except Exception as e:
            print(f"Personal broadcast error (Redis down?): {e}")

    async def broadcast_msg(self, message: dict, user_ids: List[int] = None):
        msg_str = json.dumps(message)
        try:
            if user_ids:
                for uid in user_ids:
                    await broadcast.publish(channel=f"channel:{uid}", message=msg_str)
            else:
                await broadcast.publish(channel="channel:global", message=msg_str)
        except Exception as e:
            print(f"Broadcast error (Redis down?): {e}")

manager = ConnectionManager()

async def notify_profile_update(user_id: int, user_data: dict):
    from database import SessionLocal, ChatRoomMember
    db = SessionLocal()
    try:
        # Get all rooms this user is in
        user_rooms = db.query(ChatRoomMember.room_id).filter(ChatRoomMember.user_id == user_id).subquery()
        # Get all unique users in those rooms
        members = db.query(ChatRoomMember.user_id).filter(ChatRoomMember.room_id.in_(user_rooms)).distinct().all()
        uids = [m[0] for m in members if m[0] != user_id]
        
        if uids:
            relay_msg = {
                "type": "profile_update",
                "user_id": user_id,
                "profile": user_data
            }
            await manager.broadcast_msg(relay_msg, user_ids=uids)
    except Exception as e:
        print(f"Failed to broadcast profile update: {e}")
    finally:
        db.close()

async def trigger_web_push(user_id: int, payload: dict, ttl: int = 0, urgency: str = "normal"):
    from database import SessionLocal, PushSubscription
    import json
    from webpush_utils import send_web_push
    
    db = SessionLocal()
    try:
        subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
        for sub in subs:
            sub_info = {
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh,
                    "auth": sub.auth
                }
            }
            try:
                success = send_web_push(sub_info, json.dumps(payload), ttl=ttl, urgency=urgency)
                if not success:
                    db.delete(sub)
            except Exception as e:
                print(f"Web push error to user {user_id}: {e}")
        db.commit()
    except Exception as e:
        print(f"Failed to fetch push subscriptions: {e}")
    finally:
        db.close()

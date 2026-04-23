from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File as FastAPIFile, Header
import uuid
import os
import secrets
from sqlalchemy.orm import Session
from cachetools import LRUCache

idempotency_cache = LRUCache(maxsize=1000)

async def validate_idempotency(x_idempotency_key: str = Header(..., alias="X-Idempotency-Key", description="Idempotency key for mutations")):
    if x_idempotency_key in idempotency_cache:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "MSG_DUPLICATE_IDEMPOTENCY",
                    "message": "Message with this client_msg_id already processed.",
                    "details": {"client_msg_id": x_idempotency_key}
                }
            }
        )
    idempotency_cache[x_idempotency_key] = True
    return x_idempotency_key
from database import SessionLocal, User, Profile, Category, Topic, Post, WikiArticle, MarketListing, Event, Message, GlobalNotification, PostLike, WikiLike, ChatRoom, ChatRoomMember, RoomKeyBundle, RoomInvite
from auth import get_current_user, oauth2_scheme
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta

router = APIRouter()

def get_display_name(user: User):
    if not user:
        return "Unknown Skuf"
    profile = user.profile[0] if isinstance(user.profile, list) and user.profile else (user.profile if not isinstance(user.profile, list) else None)
    return profile.nickname if profile and getattr(profile, 'nickname', None) else user.username

# --- Schemas ---
class WikiCreate(BaseModel):
    title: str
    content: str

class TopicCreate(BaseModel):
    title: str
    category_id: int

class PostCreate(BaseModel):
    content: str

class MarketCreate(BaseModel):
    title: str
    description: str
    price: str

class EventCreate(BaseModel):
    title: str
    description: str
    event_date: datetime
    location: str
from typing import List, Optional

class MessageCreate(BaseModel):
    receiver_id: Optional[int] = None
    room_id: Optional[int] = None
    content: str
    encryption_iv: Optional[str] = "" # Default to empty string for E2EE
    file_url: Optional[str] = None
    reply_to_id: Optional[int] = None

class RoomCreate(BaseModel):
    name: str
    room_type: str = 'group' # private, group, channel
    is_public: bool = False
    target_user_id: Optional[int] = None

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    room_type: str = 'group'  # group or channel
    is_public: bool = False   # False = invite-only (private)
    initial_members: List[int] = []  # User IDs to add immediately

class InviteCreate(BaseModel):
    max_uses: Optional[int] = None     # None = unlimited
    expires_hours: Optional[int] = None  # None = no expiry

class MemberRoleUpdate(BaseModel):
    role: str  # admin, member, banned

class RoomMembersAdd(BaseModel):
    user_ids: List[int]

class NotificationCreate(BaseModel):
    message: str
    level: str = 'info'

class ProfileUpdate(BaseModel):
    username: str = None
    handle: str = None
    nickname: str = None
    bio: str = None
    rank: str = None
    avatar_url: str = None

class PublicKeyUpdate(BaseModel):
    public_key: str

# --- Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
def update_karma(db: Session, user_id: int, amount: int = 10):
    """Increments karma and updates rank based on thresholds"""
    profile = db.query(Profile).filter(Profile.user_id == user_id).first()
    if not profile:
        profile = Profile(user_id=user_id)
        db.add(profile)

    profile.karma += amount

    # Rank Thresholds
    if profile.karma >= 1501:
        profile.rank = 'Хранитель Архива'
    elif profile.karma >= 501:
        profile.rank = 'Спец по Железу'
    elif profile.karma >= 101:
        profile.rank = 'Полевой Оператор'
    else:
        profile.rank = 'Новичок в майке'

    db.commit()
    return profile




# --- REGISTRY MODULE ---
@router.get('/registry')
def get_registry(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profiles = db.query(Profile).all()
    return [{"id": p.user_id, "username": p.user.username, "display_name": get_display_name(p.user), "rank": p.rank, "karma": p.karma, "avatar_url": p.avatar_url} for p in profiles]


@router.get('/profile')
def get_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "nickname": profile.nickname,
        "email": current_user.email,
        "rank": profile.rank,
        "karma": profile.karma,
        "bio": profile.bio,
        "avatar_url": profile.avatar_url,
        "is_online": profile.is_online
    }

@router.get('/me')
def get_my_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    return {
        "id": current_user.id,
        "username": current_user.username,
        "handle": current_user.handle if current_user.handle else "",
        "is_superadmin": current_user.is_superadmin,
        "nickname": profile.nickname if profile else "",
        "display_name": profile.nickname if (profile and profile.nickname) else current_user.username,
        "email": current_user.email,
        "rank": profile.rank if profile else "Новичок",
        "karma": profile.karma if profile else 0,
        "bio": profile.bio if profile else "",
        "avatar_url": profile.avatar_url if profile else ""
    }

@router.post('/me/update')
def update_my_profile(data: ProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    # 1. Update User table (Username/Callsign)
    user_db = db.query(User).filter(User.id == current_user.id).first()
    if data.username and data.username != user_db.username:
        # Check if username exists
        existing = db.query(User).filter(User.username == data.username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Callsign already taken by another operative")
        user_db.username = data.username

    if data.handle is not None:
        user_db.handle = data.handle

    # 2. Update Profile table
    profile = db.query(Profile).filter(Profile.user_id == user_db.id).first()
    if not profile:
        profile = Profile(user_id=user_db.id)
        db.add(profile)
    
    if data.nickname is not None: profile.nickname = data.nickname
    if data.bio is not None: profile.bio = data.bio
    if data.avatar_url is not None: profile.avatar_url = data.avatar_url
    
    db.commit()
    return {
        "id": user_db.id,
        "username": user_db.username,
        "handle": user_db.handle if user_db.handle else "",
        "is_superadmin": user_db.is_superadmin,
        "nickname": profile.nickname,
        "display_name": profile.nickname if profile.nickname else user_db.username,
        "email": user_db.email,
        "rank": profile.rank,
        "karma": profile.karma,
        "bio": profile.bio,
        "avatar_url": profile.avatar_url
    }

class AvatarUpdate(BaseModel):
    avatar_url: str

@router.post('/me/avatar')
def update_avatar(data: AvatarUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile and data.avatar_url:
        profile.avatar_url = data.avatar_url
        
    db.commit()
    return {"status": "Avatar updated successfully"}

# [FIX-07] Removed duplicate /me/key route (kept the full implementation below at line 347)



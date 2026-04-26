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




# --- WIKI MODULE ---
@router.get('/wiki', response_model=List[dict])
def get_wiki(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    articles = db.query(WikiArticle).all()
    articles_data = []
    for a in articles:
        likes_count = db.query(WikiLike).filter(WikiLike.article_id == a.id).count()
        articles_data.append({
            "id": a.id, 
            "title": a.title, 
            "content": a.content or "",
            "author": a.author_id, 
            "likes": likes_count,
            "is_verified": a.is_verified
        })
    return articles_data

@router.get('/wiki/{article_id}', response_model=dict)
def get_wiki_detail(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Fetches full article data from the Cyber-Industrial archives."""
    article = db.query(WikiArticle).filter(WikiArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article lost in the digital void")
    likes_count = db.query(WikiLike).filter(WikiLike.article_id == article.id).count()
    return {
        "id": article.id, 
        "title": article.title, 
        "content": article.content,
        "author": article.author_id, 
        "likes": likes_count,
        "is_verified": article.is_verified
    }

@router.post('/wiki/{article_id}/like')
def like_wiki(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    """Pins a seal of approval (LIKE) on a wiki article"""
    existing_like = db.query(WikiLike).filter(WikiLike.article_id == article_id, WikiLike.user_id == current_user.id).first()
    if existing_like:
        db.delete(existing_like)
        db.commit()
        return {"status": "unliked"}
    
    db.add(WikiLike(article_id=article_id, user_id=current_user.id))
    db.commit()
    return {"status": "liked"}

@router.post('/wiki')
def create_article(article: WikiCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    db_article = WikiArticle(**article.model_dump(), author_id=current_user.id)
    db.add(db_article)
    update_karma(db, current_user.id, amount=20) # Wiki articles give more karma
    return {"status": "Article archived in the Great Library"}



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
from schemas import CategoryResponse, TopicResponse, PostResponse

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




# --- FORUM MODULE ---
@router.get('/categories', response_model=List[CategoryResponse])
def list_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lists all forum categories"""
    categories = db.query(Category).order_by(Category.order.asc()).all()
    return categories

@router.get('/topics', response_model=List[TopicResponse])
def list_topics(category_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lists all active transmissions (topics) in the forum"""
    query = db.query(Topic)
    if category_id:
        query = query.filter(Topic.category_id == category_id)
    topics = query.order_by(Topic.created_at.desc()).all()
    return [{"id": t.id, "title": t.title, "author": get_display_name(t.author), "created_at": t.created_at, "category_id": t.category_id} for t in topics]

@router.post('/topics')
def create_topic(topic: TopicCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    """Initializes a new forum thread"""
    db_topic = Topic(title=topic.title, category_id=topic.category_id, author_id=current_user.id)
    db.add(db_topic)
    db.commit()
    db.refresh(db_topic)
    update_karma(db, current_user.id, amount=10)
    return {"id": db_topic.id, "status": "Carrier signal established. Topic live."}

@router.get('/topics/{topic_id}/posts', response_model=List[PostResponse])
def get_posts(topic_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retrieves all posts for a forum topic with like counts"""
    posts = db.query(Post).filter(Post.topic_id == topic_id).all()
    posts_data = []
    for p in posts:
        likes_count = db.query(PostLike).filter(PostLike.post_id == p.id).count()
        posts_data.append({
            "id": p.id,
            "content": p.content,
            "author": get_display_name(p.author),
            "created_at": p.created_at,
            "likes": likes_count
        })
    return posts_data

@router.post('/topics/{topic_id}/reply')
def reply_topic(topic_id: int, post: PostCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    """Appends a new transmission to an existing topic"""
    db_post = Post(topic_id=topic_id, author_id=current_user.id, content=post.content)
    db.add(db_post)
    db.commit()
    update_karma(db, current_user.id, amount=5)
    return {"status": "Message transmitted to topic thread"}

@router.post('/posts/{post_id}/like')
def like_post(post_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    """Pins a seal of approval (LIKE) on a forum post"""
    existing_like = db.query(PostLike).filter(PostLike.post_id == post_id, PostLike.user_id == current_user.id).first()
    if existing_like:
        db.delete(existing_like)
        db.commit()
        return {"status": "unliked"}
    
    db.add(PostLike(post_id=post_id, user_id=current_user.id))
    db.commit()
    return {"status": "liked"}



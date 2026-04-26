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




# --- MARKET MODULE ---
class MarketCreate(BaseModel):
    title: str
    price: float
    description: str = ""
    category: str = "Разное"
    location: str = "Вся сеть"

class MarketUpdate(BaseModel):
    title: str | None = None
    price: float | None = None
    description: str | None = None
    category: str | None = None
    location: str | None = None

@router.get('/market')
def get_market_listings(
    category: str = None, 
    location: str = None, 
    q: str = None, 
    min_price: float = None,
    max_price: float = None,
    sort: str = "newest",
    page: int = 1, 
    per_page: int = 20, 
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    
    query = db.query(MarketListing).filter(MarketListing.is_active == True)
    if category and category != "Все":
        query = query.filter(MarketListing.category == category)
    if location and location != "Везде":
        query = query.filter(MarketListing.location == location)
    if q:
        search_pattern = f"%{q}%"
        query = query.filter((MarketListing.title.ilike(search_pattern)) | (MarketListing.description.ilike(search_pattern)))
    if min_price is not None:
        query = query.filter(MarketListing.price >= min_price)
    if max_price is not None:
        query = query.filter(MarketListing.price <= max_price)
        
    if sort == "price_asc":
        query = query.order_by(MarketListing.price.asc())
    elif sort == "price_desc":
        query = query.order_by(MarketListing.price.desc())
    else:
        query = query.order_by(MarketListing.created_at.desc())
        
    total = query.count()
    pages = (total + per_page - 1) // per_page if total > 0 else 1
    listings = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total": total,
        "page": page,
        "pages": pages,
        "items": [{
            "id": m.id,
            "title": m.title,
            "price": float(m.price),
            "description": m.description,
            "category": m.category,
            "location": m.location,
            "seller": get_display_name(m.seller),
            "seller_id": m.seller_id,
            "status": m.status,
            "views_count": m.views_count,
            "created_at": m.created_at.isoformat() if m.created_at else None
        } for m in listings]
    }

@router.post('/market')
def create_market_listing(market: MarketCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    db_market = MarketListing(
        title=market.title,
        price=market.price,
        description=market.description,
        category=market.category,
        location=market.location,
        seller_id=current_user.id
    )
    db.add(db_market)
    update_karma(db, current_user.id, amount=5)
    db.commit()
    db.refresh(db_market)
    return {"id": db_market.id, "status": "Listing active"}

@router.get('/market/{item_id}')
def get_market_listing(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(MarketListing).filter(MarketListing.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Lot not found")
    item.views_count += 1
    db.commit()
    images = [img.image_url for img in item.images]
    return {
        "id": item.id,
        "title": item.title,
        "price": float(item.price),
        "description": item.description,
        "category": item.category,
        "location": item.location,
        "seller": get_display_name(item.seller),
        "seller_id": item.seller_id,
        "status": item.status,
        "views_count": item.views_count,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "images": images
    }

@router.put('/market/{item_id}')
def update_market_listing(item_id: int, update: MarketUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(MarketListing).filter(MarketListing.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Lot not found")
    if item.seller_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this lot")
    
    if update.title is not None:
        item.title = update.title
    if update.price is not None:
        item.price = update.price
    if update.description is not None:
        item.description = update.description
    if update.category is not None:
        item.category = update.category
    if update.location is not None:
        item.location = update.location
    db.commit()
    return {"status": "success"}

class MarketStatusUpdate(BaseModel):
    status: str

@router.patch('/market/{item_id}/status')
def update_market_status(item_id: int, update: MarketStatusUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(MarketListing).filter(MarketListing.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Lot not found")
    if item.seller_id != current_user.id and (not current_user.profile or current_user.profile.rank != "admin"):
        raise HTTPException(status_code=403, detail="Not authorized to update this lot")

    item.status = update.status
    if update.status == "sold":
        item.is_active = False
    db.commit()
    return {"status": "success"}

@router.delete('/market/{item_id}')
def delete_market_listing(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db), idem_key: str = Depends(validate_idempotency)):
    item = db.query(MarketListing).filter(MarketListing.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Lot not found")
    if item.seller_id != current_user.id and (not current_user.profile or current_user.profile.rank != "admin"):
        raise HTTPException(status_code=403, detail="Not authorized to delete this lot")
    
    db.delete(item)
    db.commit()
    return {"status": "success"}

@router.get('/market/recommended')
def get_recommended_listings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Заглушка рекомендательной системы (Пока возвращает 3 самых новых)
    # В будущем здесь будет FTS5 или векторный поиск
    listings = db.query(MarketListing).filter(MarketListing.is_active == True).order_by(MarketListing.created_at.desc()).limit(3).all()
    return [{
        "id": m.id, 
        "title": m.title, 
        "price": m.price, 
        "description": m.description, 
        "category": m.category,
        "location": m.location,
        "seller": get_display_name(m.seller),
        "seller_id": m.seller_id
    } for m in listings]



from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, Boolean, Index, Numeric, UniqueConstraint, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.types import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker, relationship, backref

from datetime import datetime
import os

# Database URL - using PostgreSQL as per blueprint
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql+psycopg2://postgres:postgres@db:5432/skufia')

# Add check_same_thread=False for SQLite
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=20,
        max_overflow=10,
        pool_pre_ping=True
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    telegram_id = Column(String, unique=True, nullable=True)
    public_key = Column(Text, nullable=True) # RSA Public Key for E2EE
    encrypted_private_key = Column(Text, nullable=True) # RSA Private Key encrypted with user password
    handle = Column(String, unique=True, nullable=True) # Short username like @up1t3rV
    recovery_email = Column(String, nullable=True)
    phone_number = Column(String, unique=True, index=True, nullable=True)
    accepted_pd = Column(Boolean, default=False)
    is_superadmin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserContact(Base):
    __tablename__ = 'user_contacts'
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    contact_name = Column(String, nullable=False)
    contact_phone = Column(String, nullable=False)
    linked_user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Profile(Base):
    __tablename__ = 'profiles'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), unique=True)
    nickname = Column(String, nullable=True)
    rank = Column(String, default='Новичок в майке')
    karma = Column(Integer, default=0)
    avatar_url = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    is_online = Column(Boolean, default=False)
    last_seen = Column(DateTime, default=datetime.utcnow)
    user = relationship('User', backref=backref('profile', uselist=False))

class Category(Base):
    __tablename__ = 'categories'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    order = Column(Integer, default=0)

class Topic(Base):
    __tablename__ = 'topics'
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey('categories.id'))
    author_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    category = relationship('Category', backref='topics')
    author = relationship('User', backref='topics')

class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey('topics.id'))
    author_id = Column(Integer, ForeignKey('users.id'))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    topic = relationship('Topic', backref='posts')
    author = relationship('User', backref='posts')

# --- CHAT & REALTIME MODULES ---

class ChatRoom(Base):
    __tablename__ = 'chat_rooms'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    room_type = Column(String, default='private') # private, group, channel
    is_public = Column(Boolean, default=False)    # True = public, False = invite-only
    owner_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    invite_code = Column(String, unique=True, nullable=True) # Primary invite link
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class RoomInvite(Base):
    """One-time or unlimited invite links for private rooms."""
    __tablename__ = 'room_invites'
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('chat_rooms.id', ondelete='CASCADE'), nullable=False)
    created_by = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    code = Column(String, unique=True, nullable=False, index=True)
    max_uses = Column(Integer, nullable=True)  # None = unlimited
    uses = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRoomMember(Base):
    __tablename__ = 'chat_room_members'
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('chat_rooms.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    role = Column(String, default='member') # admin, member, banned
    unread_count = Column(Integer, default=0)
    joined_at = Column(DateTime, default=datetime.utcnow)

class ChatFolder(Base):
    __tablename__ = 'chat_folders'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    name = Column(String, nullable=False)
    icon = Column(String, nullable=True) # Emoji icon or SVG ref
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatFolderMember(Base):
    __tablename__ = 'chat_folder_members'
    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey('chat_folders.id', ondelete='CASCADE'))
    room_id = Column(Integer, ForeignKey('chat_rooms.id', ondelete='CASCADE'))
    added_at = Column(DateTime, default=datetime.utcnow)

# --- ENTERPRISE MODULES ---

class WikiArticle(Base):
    __tablename__ = 'wiki_articles'
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    author_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow())
    is_verified = Column(Boolean, default=False)

class MarketListing(Base):
    __tablename__ = 'market_listings'
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    price = Column(Numeric(10, 2), nullable=False)
    price_type = Column(String, default='fixed')
    category = Column(String, nullable=True, default='Разное')
    location = Column(String, nullable=True, default='Вся сеть')
    seller_id = Column(Integer, ForeignKey('users.id'))
    seller = relationship("User")
    status = Column(String, default='active')
    views_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    __table_args__ = (
        Index('ix_market_search', 'category', 'is_active', 'created_at'),
    )

class ListingImage(Base):
    __tablename__ = 'listing_images'
    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey('market_listings.id', ondelete='CASCADE'))
    image_url = Column(String, nullable=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    listing = relationship('MarketListing', backref='images')

class ListingFavorite(Base):
    __tablename__ = 'listing_favorites'
    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey('market_listings.id', ondelete='CASCADE'))
    user_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('listing_id', 'user_id', name='uix_user_listing_fav'),
    )

class Event(Base):
    __tablename__ = 'events'
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    event_date = Column(DateTime, nullable=False)
    location = Column(String)
    organizer_id = Column(Integer, ForeignKey('users.id'))
    organizer = relationship("User")
    created_at = Column(DateTime, default=datetime.utcnow)

class Message(Base):
    __tablename__ = 'messages'
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey('users.id'))
    receiver_id = Column(Integer, ForeignKey('users.id'), nullable=True) # Direct messages
    room_id = Column(Integer, ForeignKey('chat_rooms.id'), nullable=True) # Room messages
    content = Column(Text, nullable=False) # Encrypted content blob for E2EE
    file_url = Column(String, nullable=True) # Attached file URL
    encryption_iv = Column(String, nullable=True) # Initialization Vector for AES
    key_version = Column(Integer, nullable=True, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_read = Column(Boolean, default=False)
    
    reply_to_id = Column(Integer, ForeignKey('messages.id'), nullable=True)
    is_edited = Column(Boolean, default=False)
    is_deleted_for_all = Column(Boolean, default=False)
    ttl_seconds = Column(Integer, nullable=True)
    reactions = Column(JSON().with_variant(JSONB, 'postgresql'), default={})
    
    sender = relationship('User', foreign_keys=[sender_id], backref='sent_messages')
    receiver = relationship('User', foreign_keys=[receiver_id], backref='received_messages')
    room = relationship('ChatRoom', foreign_keys=[room_id], backref='messages')

    __table_args__ = (
        Index('idx_messages_reactions_gin', 'reactions', postgresql_using='gin'),
    )

class FCMToken(Base):
    __tablename__ = 'fcm_tokens'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    token = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship('User', backref='fcm_tokens')

class GlobalNotification(Base):
    __tablename__ = 'global_notifications'
    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    level = Column(String, default='info') # info, warning, critical
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class PostLike(Base):
    __tablename__ = 'post_likes'
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey('posts.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)

class WikiLike(Base):
    __tablename__ = 'wiki_likes'
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey('wiki_articles.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)

class RoomKeyBundle(Base):
    """
    Stores the AES-256 session key for a chat room, encrypted with each
    participant's RSA public key (RSA-OAEP). Each user gets their own
    encrypted copy so only they can decrypt it with their private key.
    This is the core of the E2EE key exchange mechanism.
    """
    __tablename__ = 'room_key_bundles'
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('chat_rooms.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    # The AES session key, wrapped (encrypted) with the user's RSA public key
    wrapped_key = Column(Text, nullable=False)
    key_version = Column(Integer, default=1, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('room_id', 'user_id', 'key_version', name='uix_room_user_key_version'),
        Index('idx_rkb_active', 'room_id', 'user_id', postgresql_where=text("is_active = true")),
    )

def init_db():
    # Import models explicitly here if not imported elsewhere,
    # but push_tokens will be imported globally.
    Base.metadata.create_all(bind=engine)

# Import new models so they get registered with Base
from models import PushTokens

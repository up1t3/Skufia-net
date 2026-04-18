from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, backref
from datetime import datetime
import os

# Database URL - using PostgreSQL as per blueprint
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./skufia.db')

engine = create_engine(DATABASE_URL)
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
    room_type = Column(String, default='private') # private, group, channel
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatRoomMember(Base):
    __tablename__ = 'chat_room_members'
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('chat_rooms.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    joined_at = Column(DateTime, default=datetime.utcnow)

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
    price = Column(String, nullable=True) # String to allow 'Trade' or 'Negotiable'
    category = Column(String, nullable=True, default='Разное')
    location = Column(String, nullable=True, default='Вся сеть')
    seller_id = Column(Integer, ForeignKey('users.id'))
    seller = relationship("User")
    status = Column(String, default='active')
    views_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)

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
    created_at = Column(DateTime, default=datetime.utcnow)
    is_read = Column(Boolean, default=False)
    
    reply_to_id = Column(Integer, ForeignKey('messages.id'), nullable=True)
    is_edited = Column(Boolean, default=False)
    
    sender = relationship('User', foreign_keys=[sender_id], backref='sent_messages')
    receiver = relationship('User', foreign_keys=[receiver_id], backref='received_messages')
    room = relationship('ChatRoom', foreign_keys=[room_id], backref='messages')

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

def init_db():
    Base.metadata.create_all(bind=engine)

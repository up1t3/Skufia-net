from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from datetime import datetime
from database import Base

class PushTokens(Base):
    __tablename__ = 'push_tokens'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    token = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

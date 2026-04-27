from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class UserBase(BaseModel):
    id: int
    username: str

class CategoryResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    order: int

    class Config:
        from_attributes = True

class TopicResponse(BaseModel):
    id: int
    title: str
    author: str
    created_at: datetime
    category_id: Optional[int] = None

    class Config:
        from_attributes = True

class PostResponse(BaseModel):
    id: int
    content: str
    author: str
    created_at: datetime
    likes: int

    class Config:
        from_attributes = True

class WikiArticleResponse(BaseModel):
    id: int
    title: str
    content: str
    category: str
    author: int
    likes: int
    is_verified: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

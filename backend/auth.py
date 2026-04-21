from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
import os
from database import SessionLocal, User, Profile
from sqlalchemy.orm import Session

# Configuration
SECRET_KEY = os.getenv('SECRET_KEY', 'skufia_super_secret_cyber_key_2000')
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 1 week for community feel

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({'exp': expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload if payload.get('sub') else None
    except JWTError:
        return None

# --- FastAPI Dependencies ---
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/auth/login')

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Decodes JWT and retrieves user from database"""
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    user = db.query(User).filter(User.id == payload.get("user_id")).first()
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deleted",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user

# --- Auth Router & Endpoints ---
router = APIRouter()

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    accepted_pd: bool = False  # ФЗ-152: Personal data processing consent

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post('/register', status_code=status.HTTP_201_CREATED)
def register_user(req: RegisterRequest, db = Depends(get_db)):
    # [ФЗ-152] Reject registration if personal data consent is not given
    if not req.accepted_pd:
        raise HTTPException(
            status_code=400, 
            detail="Необходимо дать согласие на обработку персональных данных (ФЗ-152)"
        )
    
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
        
    hashed_pwd = get_password_hash(req.password)
    new_user = User(
        username=req.username,
        email=req.email,
        hashed_password=hashed_pwd,
        accepted_pd=True  # Confirmed consent at registration time
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create an empty profile for the new user
    new_profile = Profile(user_id=new_user.id)
    db.add(new_profile)
    db.commit()
    
    return {"message": "User registered successfully", "user_id": new_user.id}

@router.post('/login')
def login_user(req: LoginRequest, db = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user.id}, 
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

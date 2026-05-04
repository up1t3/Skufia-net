from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
import os
from database import SessionLocal, User, Profile, PasswordResetCode
from sqlalchemy.orm import Session
from rate_limit import RateLimiter

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

@router.post('/register', status_code=status.HTTP_201_CREATED, dependencies=[Depends(RateLimiter(limit=5, window=60))])
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

@router.post('/login', dependencies=[Depends(RateLimiter(limit=5, window=60))])
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


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    encrypted_private_key: Optional[str] = None

@router.post('/change-password', dependencies=[Depends(RateLimiter(limit=5, window=60))])
def change_password(req: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный старый пароль")
    
    current_user.hashed_password = get_password_hash(req.new_password)
    
    # Update the E2EE private key if provided (re-encrypted with new password)
    if req.encrypted_private_key:
        current_user.encrypted_private_key = req.encrypted_private_key
        
    db.commit()
    return {"message": "Пароль успешно изменен"}

class ForgotPasswordRequest(BaseModel):
    username_or_email: str

import random
import string
import smtplib
from email.mime.text import MIMEText

def send_recovery_email(to_email: str, code: str):
    try:
        sender_email = os.getenv('SMTP_EMAIL', 'skuf-net@yandex.com')
        sender_password = os.getenv('SMTP_PASSWORD', 'jzglcxwopljrzyvp')
        
        msg = MIMEText(f"Ваш код для сброса пароля в SKUFenger:\n\n{code}\n\nКод действителен в течение 15 минут. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.")
        msg['Subject'] = 'SKUFenger: Восстановление пароля'
        msg['From'] = f"SKUFenger <{sender_email}>"
        msg['To'] = to_email

        server = smtplib.SMTP_SSL('smtp.yandex.ru', 465)
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, [to_email], msg.as_string())
        server.quit()
        print(f"[SECURITY] Email с кодом сброса успешно отправлен на {to_email}")
    except Exception as e:
        print(f"[ERROR] Ошибка отправки email: {e}")

@router.post('/forgot-password', dependencies=[Depends(RateLimiter(limit=3, window=60))])
def forgot_password(req: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        (User.username == req.username_or_email) | (User.email == req.username_or_email)
    ).first()
    
    if not user:
        # Prevent user enumeration by always returning success
        return {"message": "Если пользователь существует, код восстановления был отправлен."}
        
    # Generate 6-digit code
    code = ''.join(random.choices(string.digits, k=6))
    
    # Send email in background if user has email configured
    # Fallback: if user didn't set email but uses username, we can't send it unless email exists.
    if user.email:
        background_tasks.add_task(send_recovery_email, user.email, code)
    else:
        print(f"\n[SECURITY] Пользователь {user.username} не имеет привязанного email. Код: {code}\n")
    
    # Save to DB
    reset_record = PasswordResetCode(
        user_id=user.id,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=15)
    )
    db.add(reset_record)
    db.commit()
    
    return {"message": "Если пользователь существует, код восстановления был отправлен."}

class ResetPasswordRequest(BaseModel):
    code: str
    new_password: str

@router.post('/reset-password', dependencies=[Depends(RateLimiter(limit=5, window=60))])
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    # Find valid code
    reset_record = db.query(PasswordResetCode).filter(
        PasswordResetCode.code == req.code,
        PasswordResetCode.expires_at > datetime.utcnow()
    ).first()
    
    if not reset_record:
        raise HTTPException(status_code=400, detail="Неверный или просроченный код восстановления")
        
    user = db.query(User).filter(User.id == reset_record.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
        
    user.hashed_password = get_password_hash(req.new_password)
    
    # CRITICAL: Clear E2EE keys because they were encrypted with the old forgotten password
    user.public_key = None
    user.encrypted_private_key = None
    
    # Delete the used code
    db.delete(reset_record)
    db.commit()
    
    return {"message": "Пароль успешно сброшен. Обратите внимание: старые E2EE чаты могут быть недоступны."}

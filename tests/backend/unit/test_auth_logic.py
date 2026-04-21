from backend.auth import get_password_hash, verify_password, create_access_token
import jwt
from datetime import timedelta
import os
import pytest

def test_password_hashing():
    password = "secret_password"
    hashed = get_password_hash(password)
    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("wrong_password", hashed)

def test_create_access_token():
    data = {"sub": "testuser"}
    token = create_access_token(data=data, expires_delta=timedelta(minutes=15))
    
    SECRET_KEY = os.getenv('SECRET_KEY', "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7")
    ALGORITHM = "HS256"
    
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["sub"] == "testuser"
    assert "exp" in payload

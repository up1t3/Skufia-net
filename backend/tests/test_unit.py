import pytest
import os
from datetime import timedelta
from passlib.context import CryptContext

# Fix absolute imports by appending backend directory to path or just use relative imports within tests
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from auth import verify_password, get_password_hash, create_access_token, decode_token

def test_password_hashing():
    pwd = "super_secret_password"
    hashed = get_password_hash(pwd)
    
    assert pwd != hashed
    assert verify_password(pwd, hashed) is True
    assert verify_password("wrong_password", hashed) is False

def test_jwt_token_generation_and_decoding():
    data = {"sub": "testuser", "user_id": 999}
    token = create_access_token(data=data, expires_delta=timedelta(minutes=15))
    
    assert isinstance(token, str)
    assert len(token) > 0
    
    decoded = decode_token(token)
    assert decoded["sub"] == "testuser"
    assert decoded["user_id"] == 999

import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from datetime import timedelta
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_token,
    get_db,
    get_current_user,
    RegisterRequest,
    LoginRequest,
    register_user,
    login_user,
    SECRET_KEY,
    ALGORITHM
)
from database import User
from jose import jwt

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

def test_decode_token_invalid_signature():
    token = jwt.encode({"sub": "test"}, "wrong_secret", algorithm=ALGORITHM)
    assert decode_token(token) is None

def test_decode_token_missing_sub():
    token = jwt.encode({"user_id": 1}, SECRET_KEY, algorithm=ALGORITHM)
    assert decode_token(token) is None

def test_get_db():
    gen = get_db()
    db = next(gen)
    assert db is not None
    try:
        next(gen)
    except StopIteration:
        pass

def test_get_current_user_invalid_token():
    with pytest.raises(HTTPException) as exc:
        get_current_user(token="invalid", db=MagicMock())
    assert exc.value.status_code == 401
    assert exc.value.detail == "Could not validate credentials"

def test_get_current_user_not_found():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    token = jwt.encode({"sub": "test", "user_id": 1}, SECRET_KEY, algorithm=ALGORITHM)

    with pytest.raises(HTTPException) as exc:
        get_current_user(token=token, db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "User not found or deleted"

def test_get_current_user_success():
    db = MagicMock()
    mock_user = User(id=1, username="test")
    db.query.return_value.filter.return_value.first.return_value = mock_user
    token = jwt.encode({"sub": "test", "user_id": 1}, SECRET_KEY, algorithm=ALGORITHM)

    user = get_current_user(token=token, db=db)
    assert user == mock_user

def test_register_user_username_exists():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [User(id=1)] # Username exists

    req = RegisterRequest(username="test", email="test@test.com", password="pwd", accepted_pd=True)
    with pytest.raises(HTTPException) as exc:
        register_user(req=req, db=db)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Username already registered"

def test_register_user_email_exists():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [None, User(id=1)] # Email exists

    req = RegisterRequest(username="test", email="test@test.com", password="pwd", accepted_pd=True)
    with pytest.raises(HTTPException) as exc:
        register_user(req=req, db=db)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Email already registered"

def test_register_user_success():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [None, None]

    req = RegisterRequest(username="test", email="test@test.com", password="pwd", accepted_pd=True)
    res = register_user(req=req, db=db)

    assert res["message"] == "User registered successfully"
    assert "user_id" in res
    assert db.add.call_count == 2
    assert db.commit.call_count == 2

def test_login_user_not_found():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    req = LoginRequest(username="test", password="pwd")
    with pytest.raises(HTTPException) as exc:
        login_user(req=req, db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Incorrect username or password"

def test_login_user_wrong_password():
    db = MagicMock()
    mock_user = User(id=1, username="test", hashed_password=get_password_hash("correct_pwd"))
    db.query.return_value.filter.return_value.first.return_value = mock_user

    req = LoginRequest(username="test", password="wrong_pwd")
    with pytest.raises(HTTPException) as exc:
        login_user(req=req, db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Incorrect username or password"

def test_login_user_success():
    db = MagicMock()
    mock_user = User(id=1, username="test", hashed_password=get_password_hash("correct_pwd"))
    db.query.return_value.filter.return_value.first.return_value = mock_user

    req = LoginRequest(username="test", password="correct_pwd")
    res = login_user(req=req, db=db)

    assert "access_token" in res
    assert res["token_type"] == "bearer"

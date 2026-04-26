from backend.database import User, Profile, ChatRoom
from sqlalchemy.exc import IntegrityError
import pytest

def test_user_creation(db_session):
    test_user = User(username="testuser", email="test@skufia.net", hashed_password="hashedpw")
    db_session.add(test_user)
    db_session.commit()
    
    assert test_user.id is not None
    assert test_user.username == "testuser"

def test_duplicate_username_fails(db_session):
    u1 = User(username="uniqueuser", email="u1@skufia.net", hashed_password="pw")
    u2 = User(username="uniqueuser", email="u2@skufia.net", hashed_password="pw")
    
    db_session.add(u1)
    db_session.commit()
    
    db_session.add(u2)
    with pytest.raises(IntegrityError):
        db_session.commit()

def test_profile_relationship(db_session):
    user = User(username="profile_user", email="pu@skufia.net", hashed_password="pw")
    db_session.add(user)
    db_session.commit()

    profile = Profile(user_id=user.id, nickname="ProBro", rank="Admin")
    db_session.add(profile)
    db_session.commit()
    
    # Reload and test backref
    db_session.refresh(user)
    assert user.profile.nickname == "ProBro"
    assert user.profile.rank == "Admin"

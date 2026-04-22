import pytest

def test_register_and_login_flow(client):
    # 1. Register
    reg_response = client.post("/auth/register", json={
        "username": "test_agent",
        "email": "test_agent@example.com",
        "password": "strongPassword123!"
    })
    
    assert reg_response.status_code == 200
    user_data = reg_response.json()
    assert user_data["username"] == "test_agent"
    
    # 2. Login
    login_response = client.post("/auth/login", json={
        "username": "test_agent",
        "password": "strongPassword123!"
    })
    
    assert login_response.status_code == 200
    login_data = login_response.json()
    assert "access_token" in login_data
    assert login_data["token_type"] == "bearer"
    
    # 3. Access Protected Route (/me)
    token = login_data["access_token"]
    me_response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    
    assert me_response.status_code == 200
    me_data = me_response.json()
    assert me_data["username"] == "test_agent"
    assert me_data["email"] == "test_agent@example.com"

def test_login_wrong_password(client):
    # Register first
    client.post("/auth/register", json={
        "username": "test_fail",
        "email": "test_fail@example.com",
        "password": "password"
    })
    
    # Login with wrong pw
    login_response = client.post("/auth/login", json={
        "username": "test_fail",
        "password": "wrong_password"
    })
    
    assert login_response.status_code == 401
    assert login_response.json()["detail"] == "Incorrect username or password"

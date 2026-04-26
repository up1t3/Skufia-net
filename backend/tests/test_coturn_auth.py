import pytest
import time
from coturn_auth import generate_turn_credentials

def test_generate_turn_credentials():
    username = "test_user"
    secret = "test_secret"
    ttl = 3600

    start_time = int(time.time())
    creds = generate_turn_credentials(username, secret, ttl)
    end_time = int(time.time())

    assert "username" in creds
    assert "password" in creds

    turn_username = creds["username"]
    parts = turn_username.split(":")
    assert len(parts) == 2

    timestamp_str, returned_username = parts
    timestamp = int(timestamp_str)

    assert returned_username == username
    assert start_time + ttl <= timestamp <= end_time + ttl

import hmac
import hashlib
import base64
import time

def generate_turn_credentials(username: str, shared_secret: str, ttl: int = 86400) -> dict:
    """
    Generates time-limited credentials for Coturn STUN/TURN server using the TURN REST API.

    Args:
        username: The user's identifier.
        shared_secret: The static shared secret configured in the Coturn server.
        ttl: Time to live in seconds (default: 86400 seconds = 24 hours).

    Returns:
        A dictionary containing the generated 'username' and 'password' for the TURN server.
    """
    timestamp = int(time.time()) + ttl
    turn_username = f"{timestamp}:{username}"

    mac = hmac.new(
        key=shared_secret.encode('utf-8'),
        msg=turn_username.encode('utf-8'),
        digestmod=hashlib.sha1
    )
    turn_password = base64.b64encode(mac.digest()).decode('utf-8')

    return {
        "username": turn_username,
        "password": turn_password,
    }

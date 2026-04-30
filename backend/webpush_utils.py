import os
import json
from pywebpush import webpush, WebPushException

VAPID_CLAIMS = {
    "sub": "mailto:admin@skufia.app"
}

VAPID_PRIVATE_KEY_PATH = os.getenv("VAPID_PRIVATE_KEY_PATH", "vapid_private.pem")

def generate_vapid_keys():
    """Generates a new VAPID keypair if it doesn't exist."""
    import cryptography.hazmat.backends
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    import base64
    
    if os.path.exists(VAPID_PRIVATE_KEY_PATH):
        return
        
    private_key = ec.generate_private_key(
        ec.SECP256R1(),
        cryptography.hazmat.backends.default_backend()
    )
    
    with open(VAPID_PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))
        
def get_vapid_public_key():
    """Reads the private key and returns the uncompressed, URL-safe base64 public key."""
    generate_vapid_keys()
    
    from cryptography.hazmat.primitives import serialization
    with open(VAPID_PRIVATE_KEY_PATH, "rb") as f:
        private_key = serialization.load_pem_private_key(
            f.read(),
            password=None
        )
        
    public_numbers = private_key.public_key().public_numbers()
    x = public_numbers.x.to_bytes(32, byteorder='big')
    y = public_numbers.y.to_bytes(32, byteorder='big')
    
    # Uncompressed format is 0x04 followed by x and y
    uncompressed_pub_key = b'\x04' + x + y
    
    import base64
    return base64.urlsafe_b64encode(uncompressed_pub_key).decode('utf-8').rstrip('=')

def send_web_push(subscription_info: dict, payload: str, ttl: int = 0, urgency: str = "normal", topic: str = None):
    """
    subscription_info format:
    {
        "endpoint": "...",
        "keys": {
            "p256dh": "...",
            "auth": "..."
        }
    }
    """
    generate_vapid_keys()
    
    headers = {"Urgency": urgency}
    if topic:
        headers["Topic"] = topic
    
    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY_PATH,
            vapid_claims=VAPID_CLAIMS,
            ttl=ttl,
            headers=headers
        )
        return True
    except WebPushException as ex:
        print(f"WebPush Error: {ex.message}")
        # If response exists, it might be 410 Gone (unsubscribe needed)
        if ex.response is not None and ex.response.status_code in [404, 410]:
            return False # indicates subscription is invalid
        raise

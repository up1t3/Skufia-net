import os
import requests
from io import BytesIO
import blurhash
from PIL import Image
from celery import Celery
import redis

# Initialize Celery app
# The architecture docs mentioned Task Broker (Celery & Redis)
celery_app = Celery(
    'skufia_worker',
    broker=os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
)

# Initialize redis connection
redis_client = redis.Redis.from_url(os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))

@celery_app.task
def compute_blurhash(image_path_or_url: str):
    """
    Takes an image file path or URL and computes a small 'Blurhash' string.
    Saves it independently to Redis.
    """
    try:
        # Load image from URL or file path
        if image_path_or_url.startswith('http://') or image_path_or_url.startswith('https://'):
            response = requests.get(image_path_or_url, timeout=10)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content))
        else:
            image = Image.open(image_path_or_url)

        # Convert to RGB if necessary (e.g. RGBA)
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Resize image for faster blurhash calculation
        # Blurhash doesn't need high res
        image.thumbnail((100, 100))

        # Generate blurhash
        import numpy as np
        img_array = np.array(image)
        hash_str = blurhash.encode(img_array, components_x=4, components_y=3)

        # Save to Redis
        redis_key = f"blurhash:{image_path_or_url}"
        redis_client.set(redis_key, hash_str)

        return hash_str
    except Exception as e:
        print(f"Error computing blurhash for {image_path_or_url}: {e}")
        return None

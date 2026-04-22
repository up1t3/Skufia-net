import os
import time
from fastapi import HTTPException, Request
import redis.asyncio as redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(REDIS_URL)

async def check_rate_limit(key: str, limit: int, window: int) -> bool:
    """
    Fixed window rate limiter using Redis.
    """
    current_time = int(time.time())
    window_start = current_time // window * window
    redis_key = f"rl:{key}:{window_start}"

    async with redis_client.pipeline(transaction=True) as pipe:
        pipe.incr(redis_key)
        pipe.expire(redis_key, window * 2)
        result = await pipe.execute()

    count = result[0]
    return count <= limit

class RateLimiter:
    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window

    async def __call__(self, request: Request):
        client_ip = request.client.host if request.client else "127.0.0.1"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        path = request.url.path
        key = f"http:{client_ip}:{path}"

        if not await check_rate_limit(key, self.limit, self.window):
            raise HTTPException(status_code=429, detail="Too Many Requests")

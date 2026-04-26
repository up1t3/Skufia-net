import time
from fastapi import Request
from prometheus_client import Counter, Histogram, Gauge, make_asgi_app

# Metrics
REQUEST_COUNT = Counter(
    "fastapi_requests_total", "Total count of requests by method and path.", ["method", "path"]
)

REQUEST_LATENCY = Histogram(
    "fastapi_request_latency_seconds", "Request latency in seconds", ["method", "path"]
)

ACTIVE_WEBSOCKETS = Gauge(
    "fastapi_active_websockets", "Number of active WebSocket connections"
)

def setup_metrics(app):
    # Mount metrics endpoint
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)

    @app.middleware("http")
    async def metrics_middleware(request: Request, call_next):
        method = request.method
        path = request.url.path

        # Don't track metrics for the metrics endpoint
        if path == "/metrics":
            return await call_next(request)

        start_time = time.time()

        response = await call_next(request)

        process_time = time.time() - start_time

        REQUEST_COUNT.labels(method=method, path=path).inc()
        REQUEST_LATENCY.labels(method=method, path=path).observe(process_time)

        return response

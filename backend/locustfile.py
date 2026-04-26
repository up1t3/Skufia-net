"""
SKUFenger Load Test — Locust
Запуск: locust -f locustfile.py --host=http://localhost:8007
"""
from locust import HttpUser, task, between, events, TaskSet
import json
import random


class SkufiaUser(HttpUser):
    wait_time = between(0.5, 2)
    token = None

    def on_start(self):
        """Register + Login to get JWT token."""
        uid = random.randint(10000, 99999)
        username = f"loadtest_{uid}"
        email = f"lt_{uid}@skufia.net"

        # Register
        self.client.post("/api/auth/register", json={
            "username": username,
            "email": email,
            "password": "loadtest123"
        }, name="/api/auth/register")

        # Login
        resp = self.client.post("/api/auth/login", json={
            "username": username,
            "password": "loadtest123"
        }, name="/api/auth/login")

        if resp.status_code == 200:
            self.token = resp.json().get("access_token")
        else:
            self.token = None

    @property
    def auth_headers(self):
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    @task(5)
    def health_check(self):
        """GET / — health endpoint."""
        self.client.get("/", name="/")

    @task(3)
    def get_wiki(self):
        """GET /api/wiki — requires auth."""
        self.client.get("/api/wiki", headers=self.auth_headers, name="/api/wiki")

    @task(3)
    def get_events(self):
        """GET /api/events."""
        self.client.get("/api/events", headers=self.auth_headers, name="/api/events")

    @task(2)
    def get_market(self):
        """GET /api/market."""
        self.client.get("/api/market", headers=self.auth_headers, name="/api/market")

    @task(2)
    def get_profile(self):
        """GET /api/profile."""
        self.client.get("/api/profile", headers=self.auth_headers, name="/api/profile")

    @task(1)
    def get_notifications(self):
        """GET /api/notifications."""
        self.client.get("/api/notifications", headers=self.auth_headers, name="/api/notifications")

class MarketChaosTasks(TaskSet):
    @task
    def search_market(self):
        """Simulate a user heavily searching the market."""
        search_terms = ["девайс", "редк", "тест", "ноутбук", "скуф"]
        q = random.choice(search_terms)
        self.client.get(f"/api/market?q={q}", headers=self.user.auth_headers, name="/api/market?q=[term]")

class ChaosLoadTest(HttpUser):
    wait_time = between(0.1, 0.5)
    tasks = [MarketChaosTasks]
    token = None

    def on_start(self):
        """Register + Login for chaos load test."""
        uid = random.randint(100000, 999999)
        username = f"chaos_{uid}"
        email = f"chaos_{uid}@skufia.net"

        self.client.post("/api/auth/register", json={
            "username": username,
            "email": email,
            "password": "loadtest123"
        }, name="/api/auth/register")

        resp = self.client.post("/api/auth/login", json={
            "username": username,
            "password": "loadtest123"
        }, name="/api/auth/login")

        if resp.status_code == 200:
            self.token = resp.json().get("access_token")
            self.auth_headers = {"Authorization": f"Bearer {self.token}"}
        else:
            self.auth_headers = {}

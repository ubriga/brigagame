"""Brigagame 2.0 by OrelAI - backend configuration.

All values come from environment variables so no secret is ever stored in
the repository. PythonAnywhere: set these in the WSGI file or a .env loaded
by it.
"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    # Flask secret (signing). MUST be overridden in production.
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")

    # Google OAuth 2.0 Web Client ID (from Google Cloud Console).
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

    # Hard-coded site owner / full admin (per product spec).
    ADMIN_EMAIL = "ubriga@gmail.com"

    # Frontend origin(s) allowed to call the API (GitHub Pages URL + local dev).
    ALLOWED_ORIGINS = [
        o.strip()
        for o in os.environ.get(
            "ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
        ).split(",")
        if o.strip()
    ]

    DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "brigagame.db"))

    # Local development only: enables passwordless dev-login endpoint.
    # NEVER set in production.
    DEV_AUTH = os.environ.get("DEV_AUTH", "") == "1"

    SESSION_TTL_DAYS = 14
    MAX_SESSIONS_PER_USER = 5
    MAX_CONTENT_LENGTH = 32 * 1024

    # Rate limits (requests per window_seconds per key).
    RATE_LIMITS = {
        "auth": (10, 60),          # login attempts
        "fire": (30, 60),          # shots
        "state": (240, 60),        # polling
        "store": (30, 60),
        "admin": (120, 60),
        "mutation": (90, 60),
        "default": (300, 60),
    }

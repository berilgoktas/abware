"""
WSGI entrypoint for production servers (gunicorn/waitress).

Usage examples:
- gunicorn -w 4 -b 0.0.0.0:5000 wsgi:app
- waitress-serve --listen=0.0.0.0:5000 wsgi:app
"""

import os

from app import create_app


# default to production unless explicitly set
os.environ.setdefault("FLASK_ENV", "production")

app = create_app(os.getenv("FLASK_ENV", "production"))





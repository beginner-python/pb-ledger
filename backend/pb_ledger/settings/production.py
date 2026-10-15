from .base import *  # noqa
import os


SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

DEBUG = False
# 本番(HTTPS)では認証関連Cookieを必ず Secure にする。
AUTH_REFRESH_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SECURE = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["DB_NAME"],
        "USER": os.environ["DB_USER"],
        "PASSWORD": os.environ["DB_PASSWORD"],
        "HOST": os.environ["DB_HOST"],
        "PORT": int(os.environ["DB_PORT"]),
    }
}

# REST_FRAMEWORK は base の設定 (JWT のみ、camelCase JSON、スロットリング) をそのまま使う。

# HTTPS 前提の設定。リバースプロキシ配下で TLS を終端する構成を想定する。
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

FRONTEND_ORIGINS = [
    origin.strip() for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",") if origin.strip()
]

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h]

# https://docs.djangoproject.com/en/5.2/ref/settings/#storages
# https://whitenoise.readthedocs.io/en/stable/django.html
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

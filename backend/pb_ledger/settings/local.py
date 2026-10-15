from .base import *  # noqa
from .base import INSTALLED_APPS, MIDDLEWARE, REST_FRAMEWORK
import os
import sys


DEBUG = True
# ローカル開発(http)では Secure Cookie が保存されないため False にする。
AUTH_REFRESH_COOKIE_SECURE = False

# manage.py test では Django が DEBUG=False にするため、debug_toolbar を入れると
# システムチェック (debug_toolbar.E001) で落ちる。テスト実行時は組み込まない。
IS_RUNNING_TESTS = len(sys.argv) > 1 and sys.argv[1] == "test"

if not IS_RUNNING_TESTS:
    INSTALLED_APPS += ["debug_toolbar"]

    MIDDLEWARE = [
        "debug_toolbar.middleware.DebugToolbarMiddleware",
        *MIDDLEWARE,
    ]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "pb_ledger"),
        "USER": os.environ.get("DB_USER", "pb_ledger"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "pb_ledger_dev_only"),
        "HOST": os.environ.get("DB_HOST", "db"),
        "PORT": int(os.environ.get("DB_PORT", 5432)),
    }
}

# ローカルだけ Browsable API と Session 認証を足す。それ以外は base の設定を引き継ぐ。
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_AUTHENTICATION_CLASSES": (
        # JWT を先頭に置く。先頭の認証クラスの authenticate_header() が
        # 401 レスポンス時の WWW-Authenticate を決めるため、Session を先頭にすると
        # アクセストークン切れ時に 403 に潰されてフロントの自動リフレッシュが
        # 効かなくなる。
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_RENDERER_CLASSES": (
        "djangorestframework_camel_case.render.CamelCaseJSONRenderer",
        "djangorestframework_camel_case.render.CamelCaseBrowsableAPIRenderer",
    ),
}

FRONTEND_ORIGINS = [
    origin.strip() for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",") if origin.strip()
]

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "backend"]

DEBUG_TOOLBAR_CONFIG = {
    "SHOW_TOOLBAR_CALLBACK": lambda request: True,
}

# Allow developer-specific overrides without tracking them in git
try:
    from .local_override import *  # noqa
except ImportError:
    pass

from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.permissions import AllowAny

from .views import LoginAPIView, LogoutAPIView, RefreshAPIView

urlpatterns = [
    path("accounts/", include("accounts.api.urls")),
    path("ledger/", include("ledger.api.urls")),
    path("household/", include("household.api.urls")),
    # ログイン: accessをJSONで返し、refreshをCookieに保存する。
    path("auth/login/", LoginAPIView.as_view(), name="auth_login"),
    # access 再発行: Cookie の refresh を使う。
    path("auth/refresh/", RefreshAPIView.as_view(), name="auth_refresh"),
    # ログアウト: refresh を失効し、Cookieを削除する。
    path("auth/logout/", LogoutAPIView.as_view(), name="auth_logout"),
    # API 仕様。スキーマ自体に秘密情報は無いので認証不要で公開する。
    path(
        "schema/",
        SpectacularAPIView.as_view(permission_classes=[AllowAny], authentication_classes=[]),
        name="schema",
    ),
    path(
        "docs/",
        SpectacularSwaggerView.as_view(
            url_name="schema", permission_classes=[AllowAny], authentication_classes=[]
        ),
        name="api_docs",
    ),
]

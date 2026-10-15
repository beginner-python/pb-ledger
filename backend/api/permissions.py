from django.conf import settings
from rest_framework.permissions import BasePermission


class FrontendOriginPermission(BasePermission):
    """
    refresh/logout で使う Permission。
    Origin ヘッダがあり、設定したフロントURLと完全一致する場合だけ許可する。
    """

    message = "Invalid or missing Origin header."

    def has_permission(self, request, view):
        # Origin が無いリクエストは要件上すべて拒否する。
        origin = request.headers.get("Origin")
        if not origin:
            return False
        # 例: https://<project>.pages.dev
        return origin in settings.FRONTEND_ORIGINS

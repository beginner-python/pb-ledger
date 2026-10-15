from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .permissions import FrontendOriginPermission
from .serializers import CustomTokenObtainPairSerializer


def set_refresh_cookie(response, refresh_token):
    # refresh token は JSON で返さず、HttpOnly Cookie に保存する。
    # これによりフロントJSから refresh を読めなくなる。
    response.set_cookie(
        key=settings.AUTH_REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response):
    # ログアウト時に refresh cookie を無効化する。
    # Path は発行時と同じにしないと確実に消えない。
    response.set_cookie(
        key=settings.AUTH_REFRESH_COOKIE_NAME,
        value="",
        max_age=0,
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
    )


class LoginAPIView(APIView):
    # permission_classes=[] でも「許可」にはなるが、
    # 何を意図しているか分かりやすくするため AllowAny を明示している。
    # （このAPIは誰でも呼んでよい、という宣言）
    permission_classes = [AllowAny]
    # 総当たり対策。base の DEFAULT_THROTTLE_RATES["login"] (10/min) を使う。
    throttle_scope = "login"
    # authentication側に AllowAny のような指定はない。
    # ここを [] にすると「認証処理自体を実行しない」動きになる。
    authentication_classes = []

    def post(self, request):
        # email/password を検証して access/refresh を発行する。
        serializer = CustomTokenObtainPairSerializer(data=request.data)
        # raise_exception=True:
        # バリデーションエラー時に例外を投げ、DRF標準の400レスポンスを返す。
        serializer.is_valid(raise_exception=True)

        # refresh はレスポンスJSONから削除し、Cookie に保存する。
        refresh_token = serializer.validated_data.pop("refresh")
        response = Response(serializer.validated_data, status=status.HTTP_200_OK)
        set_refresh_cookie(response, refresh_token)
        return response


class RefreshAPIView(APIView):
    # permission_classes=[AllowAny, FrontendOriginPermission] は矛盾しない。
    # DRF Permissionは全てAND評価されるため、
    # - AllowAny: ログイン状態は問わない
    # - FrontendOriginPermission: Originが正しいことは必須
    # の両方を満たす必要がある。
    permission_classes = [AllowAny, FrontendOriginPermission]
    authentication_classes = []

    def post(self, request):
        # refresh は Cookie からのみ読む（リクエスト本文は使わない）。
        refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if not refresh_token:
            response = Response(
                {"detail": "Refresh token not found in cookie"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            clear_refresh_cookie(response)
            return response

        serializer = TokenRefreshSerializer(data={"refresh": refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            response = Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        response = Response(
            {"access": serializer.validated_data["access"]}, status=status.HTTP_200_OK
        )

        # refresh rotation が有効なため、新しい refresh が返れば Cookie を更新する。
        rotated_refresh_token = serializer.validated_data.get("refresh")
        if rotated_refresh_token:
            set_refresh_cookie(response, rotated_refresh_token)

        return response


class LogoutAPIView(APIView):
    # ログアウトは Origin 必須チェックで保護する。
    permission_classes = [AllowAny, FrontendOriginPermission]
    authentication_classes = []

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if refresh_token:
            try:
                # 使われた refresh を blacklist に登録して再利用を防ぐ。
                RefreshToken(refresh_token).blacklist()
            except TokenError:
                # 期限切れ等でも logout 自体は成功させる。
                pass

        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response

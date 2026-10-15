from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

LOGIN_URL = "/api/auth/login/"


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class LoginThrottleTests(TestCase):
    """ログイン API は総当たり対策として専用のレート制限を持つ。"""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        get_user_model().objects.create_user(email="user@example.com", password="correct-pw")

    def test_login_is_rate_limited_per_scope(self):
        from django.conf import settings

        limit = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["login"].split("/")[0])
        payload = {"email": "user@example.com", "password": "wrong"}
        for _ in range(limit):
            res = self.client.post(LOGIN_URL, payload, format="json")
            self.assertNotEqual(res.status_code, 429)
        res = self.client.post(LOGIN_URL, payload, format="json")
        self.assertEqual(res.status_code, 429)

    def test_login_succeeds_within_limit(self):
        res = self.client.post(
            LOGIN_URL, {"email": "user@example.com", "password": "correct-pw"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.json())


class ApiSchemaTests(TestCase):
    """OpenAPI スキーマと Swagger UI は認証なしで取得できる。"""

    def test_schema_is_public_and_valid(self):
        res = APIClient().get("/api/schema/", HTTP_ACCEPT="application/vnd.oai.openapi")
        self.assertEqual(res.status_code, 200)
        body = res.content.decode("utf-8")
        self.assertIn("openapi: 3", body)
        self.assertIn("/api/ledger/assets/", body)
        # 応答は camelCase で配信されるので、スキーマも camelCase になっている
        self.assertIn("totalAssets", body)

    def test_docs_page_is_public(self):
        res = APIClient().get("/api/docs/")
        self.assertEqual(res.status_code, 200)

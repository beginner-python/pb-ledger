from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        # SimpleJWT標準の access/refresh 生成に、ログイン直後に使う user 情報を追加する。
        data = super().validate(attrs)
        user = self.user
        data.update(
            {
                "user": {
                    "id": user.id,
                    "email": user.email,
                }
            }
        )
        return data

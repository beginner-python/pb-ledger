"""OpenAPI 用の共通 serializer。応答の形を文書化するためだけに使い、ビューの処理には関与しない。"""

from rest_framework import serializers


class ErrorOut(serializers.Serializer):
    error = serializers.CharField(help_text="利用者向けのエラーメッセージ")


class DetailOut(serializers.Serializer):
    detail = serializers.CharField(help_text="利用者向けのエラーメッセージ (DRF 標準の形式)")


class CreatedOut(serializers.Serializer):
    created = serializers.IntegerField(help_text="作成した件数")


class DeletedOut(serializers.Serializer):
    deleted = serializers.IntegerField(help_text="削除した件数")


class LoginIn(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()


class LoginUserOut(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()


class LoginOut(serializers.Serializer):
    access = serializers.CharField(help_text="アクセストークン (JWT、有効期限は短い)")
    user = LoginUserOut()


class AccessOut(serializers.Serializer):
    access = serializers.CharField(help_text="再発行したアクセストークン")

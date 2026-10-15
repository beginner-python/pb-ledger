"""残高スナップショットの一覧・登録・編集・削除。"""

from __future__ import annotations

from datetime import date

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api.balances import snapshot_payload
from ledger.api.constants import FINANCIAL_ASSET_KIND, KIND_TO_PAYMENT_TYPE
from ledger.api.parsing import InvalidAmountError, normalize_asset_kind, parse_amount
from ledger.models import (
    AccountBalanceSnapshot,
    FinancialAsset,
    FinancialAssetSnapshot,
    PaymentAccount,
)


class SnapshotCreateAPIView(APIView):
    def get(self, request):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )
        account_id = request.query_params.get("account_id") or request.query_params.get("accountId")

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "資産を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            if not FinancialAsset.objects.filter(id=account_id).exists():
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshots = FinancialAssetSnapshot.objects.filter(
                financial_asset_id=account_id
            ).order_by("-as_of", "-id")
        else:
            if not PaymentAccount.objects.filter(
                id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
            ).exists():
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshots = AccountBalanceSnapshot.objects.filter(account_id=account_id).order_by(
                "-as_of", "-id"
            )

        return Response(
            {"snapshots": [snapshot_payload(snapshot, asset_kind) for snapshot in snapshots]}
        )

    def post(self, request):
        asset_kind = normalize_asset_kind(
            request.data.get("asset_kind") or request.data.get("assetKind")
        )
        account_id = request.data.get("account_id")
        as_of = request.data.get("as_of")
        balance = request.data.get("balance")
        notes = request.data.get("notes") or ""

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "資産を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not as_of:
            return Response(
                {"error": "日付を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if balance is None:
            return Response(
                {"error": "残高を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            balance_value = parse_amount(str(balance))
        except InvalidAmountError:
            return Response(
                {"error": "残高の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            as_of_date = date.fromisoformat(as_of)
        except ValueError:
            return Response(
                {"error": "日付の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                if asset_kind == FINANCIAL_ASSET_KIND:
                    if not FinancialAsset.objects.filter(id=account_id).exists():
                        return Response(
                            {"error": "金融資産が見つかりません。"},
                            status=status.HTTP_404_NOT_FOUND,
                        )
                    FinancialAssetSnapshot.objects.create(
                        financial_asset_id=account_id,
                        as_of=as_of_date,
                        amount=balance_value,
                        notes=notes.strip(),
                    )
                else:
                    if not PaymentAccount.objects.filter(
                        id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
                    ).exists():
                        return Response(
                            {"error": "取引先口座がみつかりません。"},
                            status=status.HTTP_404_NOT_FOUND,
                        )
                    AccountBalanceSnapshot.objects.create(
                        account_id=account_id,
                        as_of=as_of_date,
                        balance=balance_value,
                        notes=notes.strip(),
                    )
        except IntegrityError:
            return Response(
                {"error": "同じ日付のスナップショットが既に登録されています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"created": 1},
            status=status.HTTP_201_CREATED,
        )


class SnapshotDetailAPIView(APIView):
    def patch(self, request, snapshot_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind")
            or request.query_params.get("assetKind")
            or request.data.get("asset_kind")
            or request.data.get("assetKind")
        )
        as_of = request.data.get("as_of")
        balance = request.data.get("balance")
        notes = request.data.get("notes") or ""

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not as_of:
            return Response(
                {"error": "日付を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if balance is None:
            return Response(
                {"error": "残高を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            balance_value = parse_amount(str(balance))
        except InvalidAmountError:
            return Response(
                {"error": "残高の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            as_of_date = date.fromisoformat(as_of)
        except ValueError:
            return Response(
                {"error": "日付の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                snapshot = FinancialAssetSnapshot.objects.get(id=snapshot_id)
            except FinancialAssetSnapshot.DoesNotExist:
                return Response(
                    {"error": "スナップショットが見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshot.as_of = as_of_date
            snapshot.amount = balance_value
            snapshot.notes = notes.strip()
        else:
            try:
                snapshot = AccountBalanceSnapshot.objects.get(id=snapshot_id)
            except AccountBalanceSnapshot.DoesNotExist:
                return Response(
                    {"error": "スナップショットが見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshot.as_of = as_of_date
            snapshot.balance = balance_value
            snapshot.notes = notes.strip()

        try:
            snapshot.save()
        except IntegrityError:
            return Response(
                {"error": "同じ日付のスナップショットが既に登録されています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "updated": 1,
                "snapshot": snapshot_payload(snapshot, asset_kind),
            }
        )

    def delete(self, request, snapshot_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            deleted, _ = FinancialAssetSnapshot.objects.filter(id=snapshot_id).delete()
        else:
            deleted, _ = AccountBalanceSnapshot.objects.filter(id=snapshot_id).delete()

        if deleted == 0:
            return Response(
                {"error": "スナップショットが見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"deleted": 1})

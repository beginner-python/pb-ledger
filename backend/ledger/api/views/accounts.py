"""決済手段 (銀行・カード・現金) の一覧・作成・更新・削除と、口座ごとの明細一覧。"""

from __future__ import annotations

from django.db.models import Count, ProtectedError, Q, Sum
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api import schema as S
from ledger.api.constants import (
    BANK_ACCOUNT_KIND,
    CREDIT_CARD_KIND,
    DECIMAL_ZERO,
    FINANCIAL_ASSET_KIND,
    KIND_TO_PAYMENT_TYPE,
    PAYMENT_TYPE_TO_KIND,
)
from ledger.api.parsing import get_month_range, normalize_asset_kind, parse_optional_int
from ledger.models import (
    AccountBalanceSnapshot,
    CashAdjustment,
    FinancialAsset,
    FinancialAssetSnapshot,
    NormalizedTransaction,
    PaymentAccount,
    Transfer,
)


class PaymentAccountsAPIView(APIView):
    """支払元として選択可能な全 PaymentAccount を返す。家計支出の選択肢用。"""

    @extend_schema(
        summary="決済手段 (銀行・カード・現金) の一覧", responses={200: S.PaymentAccountsOut}
    )
    def get(self, request):
        accounts = (
            PaymentAccount.objects.filter(is_archived=False)
            .order_by("type", "display_order", "id")
            .values("id", "name", "type")
        )
        return Response(
            {
                "accounts": [
                    {
                        "id": account["id"],
                        "name": account["name"],
                        "type": account["type"],
                        "kind": PAYMENT_TYPE_TO_KIND[account["type"]],
                    }
                    for account in accounts
                ]
            }
        )


class BankAccountCreateAPIView(APIView):
    @extend_schema(
        summary="口座・カード・現金・金融資産を作成",
        request=S.AccountCreateIn,
        responses={201: S.CreatedOut, 400: S.ErrorOut},
    )
    def post(self, request):
        asset_kind = normalize_asset_kind(
            request.data.get("asset_kind") or request.data.get("assetKind")
        )
        name = (request.data.get("name") or "").strip()

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not name:
            return Response(
                {"error": "名前を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            FinancialAsset.objects.create(name=name)
            return Response({"created": 1}, status=status.HTTP_201_CREATED)

        # PaymentAccount 系（銀行/クレカ/現金）
        payment_type = KIND_TO_PAYMENT_TYPE[asset_kind]
        kwargs = {"type": payment_type, "name": name}

        if asset_kind == BANK_ACCOUNT_KIND:
            kwargs["branch_name"] = (request.data.get("branch_name") or "").strip()
            kwargs["account_number"] = (request.data.get("account_number") or "").strip()

        if asset_kind == CREDIT_CARD_KIND:
            kwargs["issuer"] = (request.data.get("issuer") or "").strip()
            last4 = (request.data.get("last4") or "").strip()
            if last4 and not last4.isdigit():
                return Response(
                    {"error": "下4桁は数字で入力してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kwargs["last4"] = last4
            try:
                closing_day = parse_optional_int(
                    request.data.get("closing_day"), min_value=1, max_value=31
                )
                payment_day = parse_optional_int(
                    request.data.get("payment_day"), min_value=1, max_value=31
                )
            except ValueError as exc:
                return Response(
                    {"error": f"締め日/引落日は {exc}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kwargs["closing_day"] = closing_day
            kwargs["payment_day"] = payment_day

        PaymentAccount.objects.create(**kwargs)
        return Response({"created": 1}, status=status.HTTP_201_CREATED)


class BankAccountDetailAPIView(APIView):
    @extend_schema(
        summary="口座を削除 (明細とスナップショットも削除)",
        parameters=[S.ASSET_KIND_PARAM],
        responses={200: S.AccountDeleteOut, 400: S.ErrorOut, 404: S.ErrorOut, 409: S.ErrorOut},
    )
    def delete(self, request, account_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )
        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                financial_asset = FinancialAsset.objects.get(id=account_id)
            except FinancialAsset.DoesNotExist:
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            deleted_snapshots = FinancialAssetSnapshot.objects.filter(
                financial_asset_id=account_id
            ).count()
            financial_asset.delete()
            return Response(
                {
                    "deleted": 1,
                    "deleted_transactions": 0,
                    "deleted_snapshots": deleted_snapshots,
                }
            )

        try:
            account = PaymentAccount.objects.get(
                id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        deleted_transactions = NormalizedTransaction.objects.filter(account_id=account_id).count()
        deleted_snapshots = AccountBalanceSnapshot.objects.filter(account_id=account_id).count()

        # Transfer / CashAdjustment は PROTECT なので、紐付きがあると削除できない。
        blockers = []
        transfer_count = Transfer.objects.filter(
            Q(from_account_id=account_id) | Q(to_account_id=account_id)
        ).count()
        if transfer_count:
            blockers.append(f"振替 {transfer_count} 件")
        adjustment_count = CashAdjustment.objects.filter(payment_account_id=account_id).count()
        if adjustment_count:
            blockers.append(f"現金の入出 {adjustment_count} 件")
        if blockers:
            return Response(
                {
                    "error": (
                        f"この口座には{'、'.join(blockers)}が紐づいているため"
                        "削除できません。先に整理してください。"
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            account.delete()
        except ProtectedError:
            return Response(
                {"error": "この口座は他の記録から参照されているため削除できません。"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {
                "deleted": 1,
                "deleted_transactions": deleted_transactions,
                "deleted_snapshots": deleted_snapshots,
            }
        )

    @extend_schema(
        summary="口座の参照 URL を更新",
        parameters=[S.ASSET_KIND_PARAM],
        request=S.AccountPatchIn,
        responses={200: S.AccountPatchOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
    def patch(self, request, account_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind")
            or request.query_params.get("assetKind")
            or request.data.get("asset_kind")
            or request.data.get("assetKind")
        )
        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                account = FinancialAsset.objects.get(id=account_id)
            except FinancialAsset.DoesNotExist:
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            try:
                account = PaymentAccount.objects.get(
                    id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
                )
            except PaymentAccount.DoesNotExist:
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        update_fields: list[str] = []

        if "reference_url" in request.data or "referenceUrl" in request.data:
            reference_url = (
                request.data.get("reference_url") or request.data.get("referenceUrl") or ""
            ).strip()
            if len(reference_url) > 500:
                return Response(
                    {"error": "URLが長すぎます。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            account.reference_url = reference_url
            update_fields.append("reference_url")

        if update_fields:
            account.save(update_fields=update_fields)

        return Response(
            {
                "account_id": account.id,
                "reference_url": account.reference_url,
            }
        )


class AccountTransactionsAPIView(APIView):
    @extend_schema(
        summary="口座の明細一覧 (月指定)",
        parameters=[S.MONTH_PARAM, S.LIMIT_PARAM],
        responses={200: S.TransactionsOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
    def get(self, request, account_id):
        if not PaymentAccount.objects.filter(id=account_id).exists():
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        limit = request.query_params.get("limit")
        try:
            limit_value = int(limit) if limit is not None else 50
        except (TypeError, ValueError):
            limit_value = 50
        limit_value = max(1, min(limit_value, 200))

        transactions = list(
            NormalizedTransaction.objects.filter(
                account_id=account_id, date__gte=start, date__lt=end_exclusive
            )
            .annotate(
                linked_expense_total=Sum("expenses__amount"),
                linked_expense_count=Count("expenses"),
            )
            .order_by("-date", "-id")[:limit_value]
        )

        tx_ids = [tx.id for tx in transactions]
        # 各 tx に紐付く Transfer (送金元側 or 送金先側) を取得
        transfer_by_from_tx: dict[int, Transfer] = {
            t.from_transaction_id: t
            for t in Transfer.objects.filter(from_transaction_id__in=tx_ids).select_related(
                "to_account"
            )
        }
        transfer_by_to_tx: dict[int, Transfer] = {
            t.to_transaction_id: t
            for t in Transfer.objects.filter(to_transaction_id__in=tx_ids).select_related(
                "from_account"
            )
        }

        payload = []
        for tx in transactions:
            linked_total = tx.linked_expense_total or DECIMAL_ZERO
            linked_transfer_id: int | None = None
            linked_transfer_amount: str | None = None
            linked_transfer_direction: str | None = None
            linked_transfer_other_account_id: int | None = None
            linked_transfer_other_account_name: str | None = None
            linked_transfer_date: str | None = None
            linked_transfer_notes: str | None = None
            # 片側だけ紐付いた振替で、反対側の明細が未設定なら完成待ち。
            linked_transfer_opposite_free = False

            tr = transfer_by_from_tx.get(tx.id)
            if tr is not None:
                linked_transfer_id = tr.id
                linked_transfer_amount = str(tr.amount)
                linked_transfer_direction = "out"  # 当該口座から出ていく振替
                linked_transfer_other_account_id = tr.to_account_id
                linked_transfer_other_account_name = tr.to_account.name
                linked_transfer_date = tr.date.isoformat()
                linked_transfer_notes = tr.notes or ""
                linked_transfer_opposite_free = tr.to_transaction_id is None
            else:
                tr = transfer_by_to_tx.get(tx.id)
                if tr is not None:
                    linked_transfer_id = tr.id
                    linked_transfer_amount = str(tr.amount)
                    linked_transfer_direction = "in"  # 当該口座へ入ってくる振替
                    linked_transfer_other_account_id = tr.from_account_id
                    linked_transfer_other_account_name = tr.from_account.name
                    linked_transfer_date = tr.date.isoformat()
                    linked_transfer_notes = tr.notes or ""
                    linked_transfer_opposite_free = tr.from_transaction_id is None

            payload.append(
                {
                    "id": tx.id,
                    "date": tx.date.isoformat(),
                    "description": tx.description or "",
                    "amount": str(tx.amount) if tx.amount is not None else None,
                    "balance": str(tx.balance) if tx.balance is not None else None,
                    "notes": tx.notes or "",
                    "linked_expense_amount": str(linked_total),
                    "linked_expense_count": tx.linked_expense_count or 0,
                    "linked_transfer_id": linked_transfer_id,
                    "linked_transfer_amount": linked_transfer_amount,
                    "linked_transfer_direction": linked_transfer_direction,
                    "linked_transfer_other_account_id": linked_transfer_other_account_id,
                    "linked_transfer_other_account_name": linked_transfer_other_account_name,
                    "linked_transfer_date": linked_transfer_date,
                    "linked_transfer_notes": linked_transfer_notes,
                    "linked_transfer_opposite_free": linked_transfer_opposite_free,
                }
            )

        return Response({"transactions": payload})

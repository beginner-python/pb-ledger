"""資産管理画面の集計: 月次サマリーと、口座・金融資産ごとの残高と前月比。"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import F, Q, Sum
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api import schema as S
from ledger.api.balances import (
    build_payment_account_payload,
    latest_financial_asset_snapshot_by_asset,
    latest_snapshot_by_account,
    latest_tx_by_account,
)
from ledger.api.constants import (
    BANK_ACCOUNT_KIND,
    CASH_KIND,
    CREDIT_CARD_KIND,
    DECIMAL_ZERO,
    FINANCIAL_ASSET_KIND,
    PAYMENT_TYPE_TO_KIND,
)
from ledger.api.parsing import get_month_range
from ledger.models import (
    BankAccount,
    FinancialAsset,
    NormalizedTransaction,
    PaymentAccount,
)


class MonthlySummaryAPIView(APIView):
    @extend_schema(
        summary="銀行口座の月次収支 (振替済み明細を除く)",
        parameters=[S.MONTH_PARAM],
        responses={200: S.MonthlySummaryOut, 400: S.ErrorOut},
    )
    def get(self, request):
        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        per_account = (
            NormalizedTransaction.objects.filter(date__gte=start, date__lt=end_exclusive)
            # 振替済の明細は資金移動であり収支ではないため除外する
            .exclude_transfer_linked()
            .values("account_id")
            .annotate(
                income=Sum("amount", filter=Q(amount__gt=0), default=0),
                expense=Sum(-F("amount"), filter=Q(amount__lt=0), default=0),
            )
        )

        accounts_payload = []
        total_income = DECIMAL_ZERO
        total_expense = DECIMAL_ZERO

        per_account_map = {row["account_id"]: row for row in per_account}

        for account in BankAccount.objects.order_by("display_order", "id").values("id"):
            row = per_account_map.get(account["id"])
            income = row["income"] if row else DECIMAL_ZERO
            expense = row["expense"] if row else DECIMAL_ZERO

            total_income += income
            total_expense += expense

            accounts_payload.append(
                {
                    "account_id": account["id"],
                    "income": str(income),
                    "expense": str(expense),
                }
            )

        return Response(
            {
                "total_income": str(total_income),
                "total_expense": str(total_expense),
                "accounts": accounts_payload,
            }
        )


class AssetsAPIView(APIView):
    @extend_schema(
        summary="資産の一覧と前月比",
        parameters=[S.MONTH_PARAM],
        responses={200: S.AssetsOut, 400: S.ErrorOut},
    )
    def get(self, request):
        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_month_start, current_month_end_exclusive = month_range
        current_month_end = current_month_end_exclusive - timedelta(days=1)
        previous_month_end = current_month_start - timedelta(days=1)

        payment_accounts = list(PaymentAccount.objects.all().order_by("display_order", "id"))
        financial_assets = list(FinancialAsset.objects.all().order_by("display_order", "id"))

        tx_now = {r["account_id"]: r for r in latest_tx_by_account(current_month_end)}
        snap_now = {r["account_id"]: r for r in latest_snapshot_by_account(current_month_end)}
        tx_prev = {r["account_id"]: r for r in latest_tx_by_account(previous_month_end)}
        snap_prev = {r["account_id"]: r for r in latest_snapshot_by_account(previous_month_end)}

        payloads_by_type: dict[str, list] = {
            BANK_ACCOUNT_KIND: [],
            CREDIT_CARD_KIND: [],
            CASH_KIND: [],
        }
        totals_now = {k: DECIMAL_ZERO for k in payloads_by_type}
        totals_prev = {k: DECIMAL_ZERO for k in payloads_by_type}

        for account in payment_accounts:
            kind = PAYMENT_TYPE_TO_KIND[account.type]
            payload, balance, previous_balance = build_payment_account_payload(
                account=account,
                kind=kind,
                tx_now_map=tx_now,
                snap_now_map=snap_now,
                tx_prev_map=tx_prev,
                snap_prev_map=snap_prev,
                current_month_start=current_month_start,
                current_month_end=current_month_end,
                previous_month_end=previous_month_end,
            )
            payloads_by_type[kind].append(payload)
            if balance is not None:
                totals_now[kind] += balance
            if previous_balance is not None:
                totals_prev[kind] += previous_balance

        financial_assets_payload = []
        financial_assets_total = DECIMAL_ZERO
        financial_assets_total_previous = DECIMAL_ZERO

        financial_snap_now = {
            r["financial_asset_id"]: r
            for r in latest_financial_asset_snapshot_by_asset(current_month_end)
        }
        financial_snap_prev = {
            r["financial_asset_id"]: r
            for r in latest_financial_asset_snapshot_by_asset(previous_month_end)
        }

        for financial_asset in financial_assets:
            snap_now_row = financial_snap_now.get(financial_asset.id)
            snap_prev_row = financial_snap_prev.get(financial_asset.id)
            balance = snap_now_row["amount"] if snap_now_row else None
            previous_balance = snap_prev_row["amount"] if snap_prev_row else None
            last_updated = snap_now_row["as_of"] if snap_now_row else None
            source = "snapshot" if snap_now_row else "none"

            balance_change = None
            if balance is not None and previous_balance is not None:
                balance_change = balance - previous_balance

            if balance is not None:
                financial_assets_total += balance
            if previous_balance is not None:
                financial_assets_total_previous += previous_balance

            financial_assets_payload.append(
                {
                    "asset_kind": FINANCIAL_ASSET_KIND,
                    "account_id": financial_asset.id,
                    "account_name": financial_asset.name,
                    "balance": str(balance) if balance is not None else None,
                    "previous_balance": str(previous_balance)
                    if previous_balance is not None
                    else None,
                    "balance_change": str(balance_change) if balance_change is not None else None,
                    "last_updated": last_updated.isoformat() if last_updated else None,
                    "source": source,
                    "has_csv_template": False,
                    "csv_template_id": None,
                    "reference_url": financial_asset.reference_url,
                }
            )

        bank_accounts_total = totals_now[BANK_ACCOUNT_KIND]
        bank_accounts_total_previous = totals_prev[BANK_ACCOUNT_KIND]
        credit_cards_total = totals_now[CREDIT_CARD_KIND]
        credit_cards_total_previous = totals_prev[CREDIT_CARD_KIND]
        cash_wallets_total = totals_now[CASH_KIND]
        cash_wallets_total_previous = totals_prev[CASH_KIND]

        # 資産管理の対象は銀行・現金・金融資産のみ。
        # クレジットカードは別画面で当月利用額を管理するため、ここでは合算しない。
        total_assets = bank_accounts_total + cash_wallets_total + financial_assets_total
        total_assets_previous = (
            bank_accounts_total_previous
            + cash_wallets_total_previous
            + financial_assets_total_previous
        )

        return Response(
            {
                "total_assets": str(total_assets),
                "total_assets_change": str(total_assets - total_assets_previous),
                "bank_accounts_total": str(bank_accounts_total),
                "bank_accounts_total_change": str(
                    bank_accounts_total - bank_accounts_total_previous
                ),
                "credit_cards_total": str(credit_cards_total),
                "credit_cards_total_change": str(credit_cards_total - credit_cards_total_previous),
                "cash_wallets_total": str(cash_wallets_total),
                "cash_wallets_total_change": str(cash_wallets_total - cash_wallets_total_previous),
                "financial_assets_total": str(financial_assets_total),
                "financial_assets_total_change": str(
                    financial_assets_total - financial_assets_total_previous
                ),
                "previous_month_end": previous_month_end.isoformat(),
                "bank_accounts": payloads_by_type[BANK_ACCOUNT_KIND],
                "credit_cards": payloads_by_type[CREDIT_CARD_KIND],
                "cash_wallets": payloads_by_type[CASH_KIND],
                "financial_assets": financial_assets_payload,
            }
        )

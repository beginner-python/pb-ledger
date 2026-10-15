"""残高の算出。銀行は明細かスナップショット、現金は動的計算、カードは当月利用額。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Sum

from ledger.api.constants import CASH_KIND, CREDIT_CARD_KIND, DECIMAL_ZERO, FINANCIAL_ASSET_KIND
from ledger.models import (
    AccountBalanceSnapshot,
    CashAdjustment,
    CashAdjustmentDirection,
    FinancialAssetSnapshot,
    NormalizedTransaction,
    Transfer,
)


def latest_tx_by_account(as_of):
    qs = NormalizedTransaction.objects.filter(balance__isnull=False)
    if as_of is not None:
        qs = qs.filter(date__lte=as_of)

    return (
        qs.order_by("account_id", "-date", "-id")
        .distinct("account_id")
        .values("account_id", "balance", "date")
    )


def latest_snapshot_by_account(as_of):
    qs = AccountBalanceSnapshot.objects.all()
    if as_of is not None:
        qs = qs.filter(as_of__lte=as_of)

    return (
        qs.order_by("account_id", "-as_of", "-id")
        .distinct("account_id")
        .values("account_id", "balance", "as_of")
    )


def latest_financial_asset_snapshot_by_asset(as_of):
    qs = FinancialAssetSnapshot.objects.all()
    if as_of is not None:
        qs = qs.filter(as_of__lte=as_of)

    return (
        qs.order_by("financial_asset_id", "-as_of", "-id")
        .distinct("financial_asset_id")
        .values("financial_asset_id", "amount", "as_of")
    )


def choose_balance(tx_row, snap_row):
    """
    tx_row: {"account_id":..., "balance":..., "date":...} or None
    snap_row: {"account_id":..., "balance":..., "as_of":...} or None
    """
    if tx_row and snap_row:
        if snap_row["as_of"] >= tx_row["date"]:
            return snap_row["balance"], snap_row["as_of"], "snapshot"
        return tx_row["balance"], tx_row["date"], "transaction"

    if snap_row:
        return snap_row["balance"], snap_row["as_of"], "snapshot"
    if tx_row:
        return tx_row["balance"], tx_row["date"], "transaction"
    return None, None, "none"


def snapshot_payload(snapshot, asset_kind):
    if asset_kind == FINANCIAL_ASSET_KIND:
        return {
            "id": snapshot.id,
            "asset_kind": asset_kind,
            "account_id": snapshot.financial_asset_id,
            "as_of": snapshot.as_of.isoformat(),
            "balance": str(snapshot.amount),
            "notes": snapshot.notes,
        }
    return {
        "id": snapshot.id,
        "asset_kind": asset_kind,
        "account_id": snapshot.account_id,
        "as_of": snapshot.as_of.isoformat(),
        "balance": str(snapshot.balance),
        "notes": snapshot.notes,
    }


def compute_cash_balance(account_id, as_of: date) -> tuple[Decimal | None, date | None, str]:
    """
    現金口座の残高を「最新スナップショット ± その後の Transfer / Expense / CashAdjustment」
    で動的に計算する。スナップショットが無い場合でも、明細(振替/支出/入出)を合算した値を返す。
    """
    from household.models import HouseholdExpense

    snap = (
        AccountBalanceSnapshot.objects.filter(account_id=account_id, as_of__lte=as_of)
        .order_by("-as_of", "-id")
        .first()
    )
    base_balance = snap.balance if snap else DECIMAL_ZERO
    base_date = snap.as_of if snap else None

    transfer_qs = Transfer.objects.filter(date__lte=as_of)
    # CashAdjustment 由来の Expense は adjustment 側で既に残高に反映済みのため除外
    expense_qs = HouseholdExpense.objects.filter(
        payment_account_id=account_id,
        date__lte=as_of,
        source_cash_adjustment__isnull=True,
    )
    adj_qs = CashAdjustment.objects.filter(payment_account_id=account_id, date__lte=as_of)
    if base_date is not None:
        transfer_qs = transfer_qs.filter(date__gt=base_date)
        expense_qs = expense_qs.filter(date__gt=base_date)
        adj_qs = adj_qs.filter(date__gt=base_date)

    transfers_in = (
        transfer_qs.filter(to_account_id=account_id).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    transfers_out = (
        transfer_qs.filter(from_account_id=account_id).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    expenses_out = expense_qs.aggregate(total=Sum("amount"))["total"] or DECIMAL_ZERO
    adj_in = (
        adj_qs.filter(direction=CashAdjustmentDirection.IN).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    adj_out = (
        adj_qs.filter(direction=CashAdjustmentDirection.OUT).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )

    balance = base_balance + transfers_in - transfers_out - expenses_out + adj_in - adj_out
    has_any_activity = (
        snap is not None or transfers_in or transfers_out or expenses_out or adj_in or adj_out
    )
    if not has_any_activity:
        return None, None, "none"

    # last_updated は「最新の動き」の日付を採用する
    last_dates = [
        d
        for d in [
            base_date,
            transfer_qs.order_by("-date").values_list("date", flat=True).first(),
            expense_qs.order_by("-date").values_list("date", flat=True).first(),
            adj_qs.order_by("-date").values_list("date", flat=True).first(),
        ]
        if d is not None
    ]
    last_updated = max(last_dates) if last_dates else None
    source = "snapshot" if snap else "computed"
    return balance, last_updated, source


def compute_credit_card_monthly_usage(card_id, year: int, month: int) -> Decimal:
    """
    クレジットカードの「その月の利用額」を取引から動的計算する。

    利用額 = -Σ(カード明細の amount for date in [year-month])

    前提:
    - カード明細 (NormalizedTransaction) の amount は出金 = 負の値
      （CSV テンプレートで利用額を withdrawal_column に設定した場合）

    締め日は考慮しない。利用日が選択月に入る charge のみを合算する
    （= ユーザがその月に使った合計）。引落 Transfer は利用額と無関係なので除外。
    """
    charges_sum = (
        NormalizedTransaction.objects.filter(
            account_id=card_id, date__year=year, date__month=month
        ).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    return -charges_sum


def _previous_year_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def build_payment_account_payload(
    *,
    account,
    kind,
    tx_now_map,
    snap_now_map,
    tx_prev_map,
    snap_prev_map,
    current_month_start: date,
    current_month_end: date,
    previous_month_end: date,
):
    if kind == CREDIT_CARD_KIND:
        balance = compute_credit_card_monthly_usage(
            account.id, current_month_start.year, current_month_start.month
        )
        prev_year, prev_month = _previous_year_month(
            current_month_start.year, current_month_start.month
        )
        previous_balance = compute_credit_card_monthly_usage(account.id, prev_year, prev_month)
        last_updated = current_month_end
        source = "computed"
    elif kind == CASH_KIND:
        balance, last_updated, source = compute_cash_balance(account.id, current_month_end)
        previous_balance, _, _ = compute_cash_balance(account.id, previous_month_end)
    else:
        balance, last_updated, source = choose_balance(
            tx_now_map.get(account.id),
            snap_now_map.get(account.id),
        )
        previous_balance, _, _ = choose_balance(
            tx_prev_map.get(account.id),
            snap_prev_map.get(account.id),
        )

    balance_change = None
    if balance is not None and previous_balance is not None:
        balance_change = balance - previous_balance

    return (
        {
            "asset_kind": kind,
            "account_id": account.id,
            "account_name": account.name,
            "balance": str(balance) if balance is not None else None,
            "previous_balance": str(previous_balance) if previous_balance is not None else None,
            "balance_change": str(balance_change) if balance_change is not None else None,
            "last_updated": last_updated.isoformat() if last_updated else None,
            "source": source,
            "has_csv_template": bool(account.default_csv_template_id),
            "csv_template_id": account.default_csv_template_id,
            "reference_url": account.reference_url,
        },
        balance,
        previous_balance,
    )

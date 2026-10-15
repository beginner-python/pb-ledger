"""支出を明細や現金入出に紐付ける際の整合性チェック (紐付け可能額、振替との競合)。"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Q, Sum
from rest_framework import status
from rest_framework.response import Response

from household.api.common import _format_yen
from household.models import (
    HouseholdExpense,
)
from ledger.models import (
    CashAdjustment,
    CashAdjustmentDirection,
    NormalizedTransaction,
    Transfer,
)


def _conflicting_sources(
    source_transaction_id: int | None, source_cash_adjustment_id: int | None
) -> Response | None:
    """明細と現金入出の両方を出どころにすると二重計上になるため拒否する。"""
    if source_transaction_id is not None and source_cash_adjustment_id is not None:
        return Response(
            {
                "detail": "紐付け明細と紐付け現金入出は同時に指定できません。",
                "code": "expense_multiple_sources",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def _transaction_locked_by_transfer(
    source_transaction: NormalizedTransaction,
) -> Response | None:
    """明細が振替と紐付いていたら家計支出の紐付けを拒否する。"""
    if Transfer.objects.filter(
        Q(from_transaction_id=source_transaction.id) | Q(to_transaction_id=source_transaction.id)
    ).exists():
        return Response(
            {
                "detail": "この明細は振替と紐付いているため家計支出にはできません。",
                "code": "transaction_locked_by_transfer",
            },
            status=status.HTTP_409_CONFLICT,
        )
    return None


def check_source_cash_adjustment_capacity(
    source_adjustment: CashAdjustment,
    new_amount: Decimal,
    exclude_expense_id: int | None = None,
) -> Response | None:
    """``source_adjustment`` に紐付ける支出合計が adjustment.amount を超えないか確認。"""
    # 現金残高の計算は「紐付き支出は adjustment 側で反映済み」とみなすため、
    # 受領 (IN) に支出を紐付けると残高がずれる。贈与 (OUT) のみ許可する。
    if source_adjustment.direction != CashAdjustmentDirection.OUT:
        return Response(
            {
                "detail": "受領 (入金) の現金入出には支出を紐付けできません。",
                "code": "source_cash_adjustment_not_out",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    existing_qs = HouseholdExpense.objects.filter(source_cash_adjustment=source_adjustment)
    if exclude_expense_id is not None:
        existing_qs = existing_qs.exclude(pk=exclude_expense_id)
    existing_total: Decimal = existing_qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    capacity = source_adjustment.amount
    remaining = capacity - existing_total

    if new_amount > remaining:
        if remaining <= 0:
            detail = (
                "この現金の入出は既に全額が支出として登録済みです。"
                "他の支出を削除するか、入出記録を再選択してください。"
            )
        else:
            detail = (
                f"登録可能金額を超えています。残り {_format_yen(remaining)} 円まで登録できます。"
            )
        return Response(
            {
                "detail": detail,
                "code": "expense_over_allocation",
                "linked_expense_amount": str(existing_total),
                "adjustment_amount": str(capacity),
                "remaining_amount": str(max(remaining, Decimal("0"))),
            },
            status=status.HTTP_409_CONFLICT,
        )
    return None


def check_source_transaction_capacity(
    source_transaction: NormalizedTransaction,
    new_amount: Decimal,
    exclude_expense_id: int | None = None,
) -> Response | None:
    """Ensure linking ``new_amount`` won't over-allocate the source transaction.

    Returns a 409 ``Response`` when the request would exceed the transaction
    amount, otherwise ``None``.
    """
    # 出金 (amount < 0) の明細だけが支出の出どころになれる。
    if source_transaction.amount is None or source_transaction.amount >= 0:
        return Response(
            {
                "detail": "入金明細や金額のない明細には支出を紐付けできません。",
                "code": "source_transaction_not_withdrawal",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    existing_qs = HouseholdExpense.objects.filter(source_transaction=source_transaction)
    if exclude_expense_id is not None:
        existing_qs = existing_qs.exclude(pk=exclude_expense_id)
    existing_total: Decimal = existing_qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    capacity = -source_transaction.amount
    remaining = capacity - existing_total

    if new_amount > remaining:
        if remaining <= 0:
            detail = (
                "この明細は既に全額が支出として登録済みです。"
                "他の支出を削除するか、明細を再選択してください。"
            )
        else:
            detail = (
                f"明細の登録可能金額を超えています。残り {_format_yen(remaining)} 円"
                "まで登録できます。"
            )
        return Response(
            {
                "detail": detail,
                "code": "expense_over_allocation",
                "linked_expense_amount": str(existing_total),
                "transaction_amount": str(capacity),
                "remaining_amount": str(max(remaining, Decimal("0"))),
            },
            status=status.HTTP_409_CONFLICT,
        )
    return None

"""現金の入出金 (人との授受) と、現金口座の履歴。"""

from __future__ import annotations

from datetime import date

from django.db.models import Count, Sum
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api.constants import DECIMAL_ZERO
from ledger.api.parsing import InvalidAmountError, get_month_range, parse_amount
from ledger.models import (
    CashAdjustment,
    CashAdjustmentCategory,
    CashAdjustmentDirection,
    PaymentAccount,
    PaymentAccountType,
    Transfer,
)


def serialize_cash_adjustment(adj: CashAdjustment) -> dict:
    return {
        "id": adj.id,
        "payment_account_id": adj.payment_account_id,
        "date": adj.date.isoformat(),
        "direction": adj.direction,
        "amount": str(adj.amount),
        "category": adj.category,
        "counterparty_name": adj.counterparty_name,
        "notes": adj.notes,
    }


VALID_CASH_DIRECTIONS = {d.value for d in CashAdjustmentDirection}
VALID_CASH_CATEGORIES = {c.value for c in CashAdjustmentCategory}


def _parse_cash_adjustment_payload(data, *, partial: bool = False):
    """request.data から CashAdjustment 用の値を取り出して検証する。"""
    result: dict = {}

    def has(key, alt=None):
        return key in data or (alt is not None and alt in data)

    def get(key, alt=None):
        return data.get(key) if key in data else data.get(alt)

    if has("payment_account_id", "paymentAccountId") or not partial:
        pa_id = get("payment_account_id", "paymentAccountId")
        if not pa_id:
            return None, "現金口座は必須です。"
        try:
            account = PaymentAccount.objects.get(id=pa_id)
        except PaymentAccount.DoesNotExist:
            return None, "現金口座が見つかりません。"
        if account.type != PaymentAccountType.CASH:
            return None, "現金口座を指定してください。"
        result["payment_account_id"] = account.id

    if has("date") or not partial:
        date_value = get("date")
        if not date_value:
            return None, "日付は必須です。"
        try:
            result["date"] = date.fromisoformat(str(date_value))
        except (ValueError, TypeError):
            return None, "日付の形式が正しくありません。"

    if has("direction") or not partial:
        direction = get("direction")
        if direction not in VALID_CASH_DIRECTIONS:
            return None, "方向は in / out で指定してください。"
        result["direction"] = direction

    if has("amount") or not partial:
        try:
            amount = parse_amount(str(get("amount") or ""))
        except InvalidAmountError:
            return None, "金額の形式が正しくありません。"
        if amount <= 0:
            return None, "金額は0より大きい値を指定してください。"
        result["amount"] = amount

    if has("category") or not partial:
        category = get("category") or CashAdjustmentCategory.OTHER.value
        if category not in VALID_CASH_CATEGORIES:
            return None, "種別の値が正しくありません。"
        result["category"] = category

    if has("counterparty_name", "counterpartyName"):
        result["counterparty_name"] = (get("counterparty_name", "counterpartyName") or "").strip()[
            :100
        ]

    if has("notes"):
        result["notes"] = (get("notes") or "").strip()[:255]

    return result, None


class CashAdjustmentListCreateAPIView(APIView):
    def get(self, request):
        qs = CashAdjustment.objects.all()
        account_id = request.query_params.get("payment_account_id") or request.query_params.get(
            "paymentAccountId"
        )
        if account_id:
            qs = qs.filter(payment_account_id=account_id)
        month_value = request.query_params.get("month")
        if month_value:
            month_range = get_month_range(month_value)
            if month_range is None:
                return Response(
                    {"error": "month は YYYY-MM 形式で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            start, end = month_range
            qs = qs.filter(date__gte=start, date__lt=end)
        adjustments = qs.order_by("-date", "-id")
        return Response(
            {
                "adjustments": [serialize_cash_adjustment(a) for a in adjustments],
            }
        )

    def post(self, request):
        parsed, error = _parse_cash_adjustment_payload(request.data, partial=False)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        adjustment = CashAdjustment.objects.create(**parsed)
        return Response(serialize_cash_adjustment(adjustment), status=status.HTTP_201_CREATED)


class CashAdjustmentDetailAPIView(APIView):
    def patch(self, request, adjustment_id):
        try:
            adjustment = CashAdjustment.objects.get(id=adjustment_id)
        except CashAdjustment.DoesNotExist:
            return Response(
                {"error": "現金の入出記録が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        parsed, error = _parse_cash_adjustment_payload(request.data, partial=True)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        for attr, value in parsed.items():
            setattr(adjustment, attr, value)
        adjustment.save()
        return Response(serialize_cash_adjustment(adjustment))

    def delete(self, request, adjustment_id):
        deleted, _ = CashAdjustment.objects.filter(id=adjustment_id).delete()
        if deleted == 0:
            return Response(
                {"error": "現金の入出記録が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"deleted": 1})


class CashAccountHistoryAPIView(APIView):
    """
    現金口座の入出履歴を Transfer / HouseholdExpense / CashAdjustment から統合して返す。
    """

    def get(self, request, account_id):
        try:
            account = PaymentAccount.objects.get(id=account_id)
        except PaymentAccount.DoesNotExist:
            return Response({"error": "口座が見つかりません。"}, status=status.HTTP_404_NOT_FOUND)
        if account.type != PaymentAccountType.CASH:
            return Response(
                {"error": "現金口座を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        from household.models import HouseholdExpense

        entries: list[dict] = []

        transfers_in = Transfer.objects.filter(
            to_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).select_related("from_account")
        for tr in transfers_in:
            entries.append(
                {
                    "kind": "transfer_in",
                    "id": tr.id,
                    "date": tr.date.isoformat(),
                    "amount_signed": str(tr.amount),
                    "label": f"{tr.from_account.name} から入金",
                    "other_account_id": tr.from_account_id,
                    "other_account_name": tr.from_account.name,
                    "notes": tr.notes or "",
                }
            )

        transfers_out = Transfer.objects.filter(
            from_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).select_related("to_account")
        for tr in transfers_out:
            entries.append(
                {
                    "kind": "transfer_out",
                    "id": tr.id,
                    "date": tr.date.isoformat(),
                    "amount_signed": str(-tr.amount),
                    "label": f"{tr.to_account.name} へ出金",
                    "other_account_id": tr.to_account_id,
                    "other_account_name": tr.to_account.name,
                    "notes": tr.notes or "",
                }
            )

        # CashAdjustment 紐付けの Expense は adjustment 側のラインに統合するため
        # 単独表示からは除外する。
        expenses = HouseholdExpense.objects.filter(
            payment_account_id=account_id,
            date__gte=start,
            date__lt=end_exclusive,
            source_cash_adjustment__isnull=True,
        ).select_related("category")
        for ex in expenses:
            entries.append(
                {
                    "kind": "expense",
                    "id": ex.id,
                    "date": ex.date.isoformat(),
                    "amount_signed": str(-ex.amount),
                    "label": ex.category.name if ex.category_id else "支出",
                    "category_name": ex.category.name if ex.category_id else "",
                    "notes": ex.notes or "",
                }
            )

        adjustments = CashAdjustment.objects.filter(
            payment_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).annotate(
            linked_expense_total=Sum("expenses__amount"),
            linked_expense_count=Count("expenses"),
        )
        for adj in adjustments:
            signed = adj.amount if adj.direction == CashAdjustmentDirection.IN else -adj.amount
            linked_total = adj.linked_expense_total or DECIMAL_ZERO
            entries.append(
                {
                    "kind": "adjustment",
                    "id": adj.id,
                    "date": adj.date.isoformat(),
                    "amount_signed": str(signed),
                    "label": "入金" if adj.direction == CashAdjustmentDirection.IN else "出金",
                    "direction": adj.direction,
                    "notes": adj.notes or "",
                    "linked_expense_amount": str(linked_total),
                    "linked_expense_count": adj.linked_expense_count or 0,
                }
            )

        entries.sort(key=lambda e: (e["date"], e["id"]), reverse=True)
        return Response({"entries": entries})

"""支出の一覧・登録・更新・削除。明細・現金入出への紐付けを含む。"""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from household.api import schema as H
from household.api.common import parse_decimal, serialize_decimal
from household.api.links import (
    _conflicting_sources,
    _transaction_locked_by_transfer,
    check_source_cash_adjustment_capacity,
    check_source_transaction_capacity,
)
from household.models import (
    HouseholdCategory,
    HouseholdExpense,
)
from ledger.models import (
    CashAdjustment,
    NormalizedTransaction,
    PaymentAccount,
)


class ExpenseCreateAPIView(APIView):
    @extend_schema(
        summary="支出の一覧",
        parameters=[
            H.YEAR_PARAM,
            H.MONTH_PARAM,
            H.PAYMENT_ACCOUNT_ID_PARAM,
            H.UNLINKED_ONLY_PARAM,
            H.SOURCE_TRANSACTION_ID_PARAM,
            H.SOURCE_CASH_ADJUSTMENT_ID_PARAM,
        ],
        responses={200: H.ExpenseOut(many=True), 400: H.DetailOut},
    )
    def get(self, request):
        year_param = request.query_params.get("year")
        month_param = request.query_params.get("month")
        source_transaction_filter = request.query_params.get(
            "source_transaction_id"
        ) or request.query_params.get("sourceTransactionId")
        source_cash_adjustment_filter = request.query_params.get(
            "source_cash_adjustment_id"
        ) or request.query_params.get("sourceCashAdjustmentId")

        expenses = HouseholdExpense.objects.select_related(
            "category", "payment_account", "source_transaction"
        ).order_by("-date", "-id")

        # source_transaction_id 指定時は year/month を任意化する。
        # 明細の請求日と支出の発生日が月を跨ぐケースを取りこぼさないため。
        if source_transaction_filter:
            try:
                expenses = expenses.filter(source_transaction_id=int(source_transaction_filter))
            except (TypeError, ValueError):
                return Response(
                    {"detail": "source_transaction_idは数値で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif source_cash_adjustment_filter:
            try:
                expenses = expenses.filter(
                    source_cash_adjustment_id=int(source_cash_adjustment_filter)
                )
            except (TypeError, ValueError):
                return Response(
                    {"detail": "source_cash_adjustment_idは数値で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            today = timezone.localdate()
            try:
                year = int(year_param) if year_param else today.year
                month = int(month_param) if month_param else today.month
            except (TypeError, ValueError):
                return Response(
                    {"detail": "yearとmonthは数値で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if month < 1 or month > 12:
                return Response(
                    {"detail": "monthは1から12で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            expenses = expenses.filter(date__year=year, date__month=month)

        payment_account_filter = request.query_params.get(
            "payment_account_id"
        ) or request.query_params.get("paymentAccountId")
        if payment_account_filter:
            try:
                pa_id = int(payment_account_filter)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "payment_account_idは数値で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # 支払元未割当の支出も紐付け候補に含める。
            # 紐付け時に source_transaction の口座が補完されるため
            # データ矛盾は発生しない。
            expenses = expenses.filter(
                Q(payment_account_id=pa_id) | Q(payment_account__isnull=True)
            )

        unlinked_param = (
            request.query_params.get("unlinked_only")
            or request.query_params.get("unlinkedOnly")
            or ""
        ).lower()
        if unlinked_param in ("1", "true", "yes"):
            expenses = expenses.filter(source_transaction__isnull=True)

        return Response(
            [
                {
                    "id": expense.id,
                    "date": expense.date.isoformat(),
                    "amount": serialize_decimal(expense.amount),
                    "notes": expense.notes,
                    "category_id": expense.category_id,
                    "category_name": expense.category.name,
                    "category_color": expense.category.color,
                    "payment_account_id": expense.payment_account_id,
                    "payment_account_name": (
                        expense.payment_account.name if expense.payment_account_id else None
                    ),
                    "payment_account_type": (
                        expense.payment_account.type if expense.payment_account_id else None
                    ),
                    "source_transaction_id": expense.source_transaction_id,
                    "source_transaction": (
                        {
                            "id": expense.source_transaction.id,
                            "date": expense.source_transaction.date.isoformat(),
                            "description": expense.source_transaction.description or "",
                            "amount": str(expense.source_transaction.amount),
                        }
                        if expense.source_transaction_id
                        else None
                    ),
                    "source_cash_adjustment_id": expense.source_cash_adjustment_id,
                }
                for expense in expenses
            ]
        )

    @extend_schema(
        summary="支出を登録",
        request=H.ExpenseIn,
        responses={201: H.ExpenseCreatedOut, 400: H.DetailOut},
    )
    def post(self, request):
        category_id = request.data.get("category_id") or request.data.get("categoryId")
        date_value = request.data.get("date")
        notes = (request.data.get("notes") or "").strip()
        payment_account_id = request.data.get("payment_account_id") or request.data.get(
            "paymentAccountId"
        )
        source_transaction_id = request.data.get("source_transaction_id") or request.data.get(
            "sourceTransactionId"
        )
        source_cash_adjustment_id = request.data.get(
            "source_cash_adjustment_id"
        ) or request.data.get("sourceCashAdjustmentId")

        if not category_id:
            return Response(
                {"detail": "category_idは必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not date_value:
            return Response(
                {"detail": "dateは必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            category = HouseholdCategory.objects.get(pk=int(category_id))
        except (HouseholdCategory.DoesNotExist, ValueError, TypeError):
            return Response(
                {"detail": "カテゴリが見つかりません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            amount = parse_decimal(request.data.get("amount"), "amount")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if amount is None:
            return Response(
                {"detail": "amountは必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parsed_date = parse_date(str(date_value)) if date_value is not None else None
        if parsed_date is None:
            return Response(
                {"detail": "dateはYYYY-MM-DD形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payment_account = None
        if payment_account_id:
            try:
                payment_account = PaymentAccount.objects.get(pk=int(payment_account_id))
            except (PaymentAccount.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "支払元が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if source_transaction_id and source_cash_adjustment_id:
            return _conflicting_sources(1, 1)

        source_transaction = None
        if source_transaction_id:
            try:
                source_transaction = NormalizedTransaction.objects.get(
                    pk=int(source_transaction_id)
                )
            except (NormalizedTransaction.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "紐付け明細が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            over_allocation = check_source_transaction_capacity(source_transaction, amount)
            if over_allocation is not None:
                return over_allocation
            locked = _transaction_locked_by_transfer(source_transaction)
            if locked is not None:
                return locked
            if payment_account is None:
                payment_account = source_transaction.account

        source_cash_adjustment = None
        if source_cash_adjustment_id:
            try:
                source_cash_adjustment = CashAdjustment.objects.get(
                    pk=int(source_cash_adjustment_id)
                )
            except (CashAdjustment.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "紐付け現金入出が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            over_allocation = check_source_cash_adjustment_capacity(source_cash_adjustment, amount)
            if over_allocation is not None:
                return over_allocation
            if payment_account is None:
                payment_account = source_cash_adjustment.payment_account

        expense = HouseholdExpense.objects.create(
            date=parsed_date,
            amount=amount,
            notes=notes,
            category=category,
            payment_account=payment_account,
            source_transaction=source_transaction,
            source_cash_adjustment=source_cash_adjustment,
        )

        return Response(
            {
                "id": expense.id,
                "date": expense.date.isoformat(),
                "amount": serialize_decimal(expense.amount),
                "notes": expense.notes,
                "category_id": expense.category_id,
                "payment_account_id": expense.payment_account_id,
                "source_transaction_id": expense.source_transaction_id,
                "source_cash_adjustment_id": expense.source_cash_adjustment_id,
            },
            status=status.HTTP_201_CREATED,
        )


class ExpenseDetailAPIView(APIView):
    @extend_schema(
        summary="支出を更新 (明細・現金入出金への紐付け変更を含む)",
        request=H.ExpensePatchIn,
        responses={200: H.ExpenseUpdatedOut, 400: H.DetailOut, 404: H.DetailOut},
    )
    def patch(self, request, expense_id: int):
        try:
            expense = HouseholdExpense.objects.select_related("category").get(pk=expense_id)
        except HouseholdExpense.DoesNotExist:
            return Response(
                {"detail": "支出が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if "category_id" in request.data:
            category_id = request.data.get("category_id")
            try:
                category = HouseholdCategory.objects.get(pk=int(category_id))
            except (HouseholdCategory.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "カテゴリが見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            expense.category = category

        if "amount" in request.data:
            try:
                amount = parse_decimal(request.data.get("amount"), "amount")
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            if amount is None:
                return Response(
                    {"detail": "amountは必須です。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            expense.amount = amount

        if "date" in request.data:
            parsed_date = parse_date(str(request.data.get("date")))
            if parsed_date is None:
                return Response(
                    {"detail": "dateはYYYY-MM-DD形式で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            expense.date = parsed_date

        if "notes" in request.data:
            expense.notes = (request.data.get("notes") or "").strip()

        if "payment_account_id" in request.data or "paymentAccountId" in request.data:
            payment_account_id = request.data.get("payment_account_id") or request.data.get(
                "paymentAccountId"
            )
            if payment_account_id in (None, ""):
                expense.payment_account = None
            else:
                try:
                    expense.payment_account = PaymentAccount.objects.get(pk=int(payment_account_id))
                except (PaymentAccount.DoesNotExist, ValueError, TypeError):
                    return Response(
                        {"detail": "支払元が見つかりません。"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        if "source_transaction_id" in request.data or "sourceTransactionId" in request.data:
            source_transaction_id = request.data.get("source_transaction_id") or request.data.get(
                "sourceTransactionId"
            )
            if source_transaction_id in (None, ""):
                expense.source_transaction = None
            else:
                try:
                    expense.source_transaction = NormalizedTransaction.objects.get(
                        pk=int(source_transaction_id)
                    )
                except (NormalizedTransaction.DoesNotExist, ValueError, TypeError):
                    return Response(
                        {"detail": "紐付け明細が見つかりません。"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # 支払元が未設定の場合は明細の口座で補完する。
                # データ矛盾 (明細口座 != 支払元) を防ぐ。
                if expense.payment_account_id is None:
                    expense.payment_account_id = expense.source_transaction.account_id

        if "source_cash_adjustment_id" in request.data or "sourceCashAdjustmentId" in request.data:
            adj_id = request.data.get("source_cash_adjustment_id") or request.data.get(
                "sourceCashAdjustmentId"
            )
            if adj_id in (None, ""):
                expense.source_cash_adjustment = None
            else:
                try:
                    expense.source_cash_adjustment = CashAdjustment.objects.get(pk=int(adj_id))
                except (CashAdjustment.DoesNotExist, ValueError, TypeError):
                    return Response(
                        {"detail": "紐付け現金入出が見つかりません。"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if expense.payment_account_id is None:
                    expense.payment_account_id = expense.source_cash_adjustment.payment_account_id

        conflict = _conflicting_sources(
            expense.source_transaction_id, expense.source_cash_adjustment_id
        )
        if conflict is not None:
            return conflict

        if expense.source_transaction_id is not None:
            over_allocation = check_source_transaction_capacity(
                expense.source_transaction,
                expense.amount,
                exclude_expense_id=expense.pk,
            )
            if over_allocation is not None:
                return over_allocation
            locked = _transaction_locked_by_transfer(expense.source_transaction)
            if locked is not None:
                return locked

        if expense.source_cash_adjustment_id is not None:
            over_allocation = check_source_cash_adjustment_capacity(
                expense.source_cash_adjustment,
                expense.amount,
                exclude_expense_id=expense.pk,
            )
            if over_allocation is not None:
                return over_allocation

        expense.save()

        return Response(
            {
                "id": expense.id,
                "date": expense.date.isoformat(),
                "amount": serialize_decimal(expense.amount),
                "notes": expense.notes,
                "category_id": expense.category_id,
                "category_name": expense.category.name,
                "category_color": expense.category.color,
                "payment_account_id": expense.payment_account_id,
                "source_transaction_id": expense.source_transaction_id,
                "source_cash_adjustment_id": expense.source_cash_adjustment_id,
            }
        )

    @extend_schema(summary="支出を削除", responses={204: None, 404: H.DetailOut})
    def delete(self, request, expense_id: int):
        try:
            expense = HouseholdExpense.objects.get(pk=expense_id)
        except HouseholdExpense.DoesNotExist:
            return Response(
                {"detail": "支出が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        expense.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

import re
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from household.models import (
    BudgetAllocation,
    BudgetPeriod,
    HouseholdCategory,
    HouseholdExpense,
)
from ledger.models import (
    CashAdjustment,
    CashAdjustmentDirection,
    NormalizedTransaction,
    PaymentAccount,
    Transfer,
)

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def serialize_decimal(value):
    if value is None:
        return None
    return str(value)


def parse_decimal(value, field_name: str):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError) as exc:
        raise ValueError(f"{field_name}は数値で指定してください。") from exc


def _format_yen(amount: Decimal) -> str:
    quantized = amount.quantize(Decimal("1"))
    return f"{int(quantized):,}"


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


class MonthlyExpenseSummaryAPIView(APIView):
    def get(self, request):
        year_param = request.query_params.get("year")
        month_param = request.query_params.get("month")

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

        queryset = HouseholdExpense.objects.filter(
            date__year=year,
            date__month=month,
        )

        totals = list(
            queryset.values(
                "category_id",
                "category__name",
                "category__color",
                "category__parent_id",
            )
            .annotate(total=Sum("amount"))
            .order_by("category__name")
        )

        items = [
            {
                "category_id": row["category_id"],
                "category_name": row["category__name"],
                "category_color": row["category__color"],
                "parent_category_id": row["category__parent_id"],
                "total": serialize_decimal(row["total"]),
            }
            for row in totals
        ]

        total_amount = sum((row["total"] or 0 for row in totals), 0)

        return Response(
            {
                "year": year,
                "month": month,
                "total": serialize_decimal(total_amount),
                "items": items,
            }
        )


class MonthlyBudgetSummaryAPIView(APIView):
    def get(self, request):
        year_param = request.query_params.get("year")
        month_param = request.query_params.get("month")

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

        period = BudgetPeriod.objects.filter(year=year, month=month).first()
        allocations = (
            BudgetAllocation.objects.filter(period=period).select_related("category")
            if period
            else BudgetAllocation.objects.none()
        )

        expense_totals = (
            HouseholdExpense.objects.filter(date__year=year, date__month=month)
            .values("category_id")
            .annotate(total=Sum("amount"))
        )
        expense_map = {row["category_id"]: row["total"] or Decimal("0") for row in expense_totals}

        # 親 → 子 ID リストのマップ。親予算の rollup 計算に使う。
        parent_to_children: dict[int, list[int]] = {}
        for child_id, parent_id in HouseholdCategory.objects.exclude(
            parent__isnull=True
        ).values_list("id", "parent_id"):
            parent_to_children.setdefault(parent_id, []).append(child_id)

        # 当月に予算が付いているカテゴリ ID の集合。
        # 「個別予算ありの子 / 親に予算ありの子」を区別するために使う。
        budgeted_category_ids = {allocation.category_id for allocation in allocations}

        items = []
        total_budget = Decimal("0")
        total_spent = Decimal("0")

        for allocation in allocations:
            own_spent = expense_map.get(allocation.category_id, Decimal("0"))
            child_ids = parent_to_children.get(allocation.category_id, [])
            children_with_budget_spent = sum(
                (
                    expense_map.get(child_id, Decimal("0"))
                    for child_id in child_ids
                    if child_id in budgeted_category_ids
                ),
                Decimal("0"),
            )
            children_without_budget_spent = sum(
                (
                    expense_map.get(child_id, Decimal("0"))
                    for child_id in child_ids
                    if child_id not in budgeted_category_ids
                ),
                Decimal("0"),
            )
            children_spent = children_with_budget_spent + children_without_budget_spent
            spent = own_spent + children_spent
            remaining = allocation.amount - spent
            usage_rate = (spent / allocation.amount * Decimal("100")) if allocation.amount else None

            items.append(
                {
                    "allocation_id": allocation.id,
                    "category_id": allocation.category_id,
                    "category_name": allocation.category.name,
                    "category_color": allocation.category.color,
                    "parent_category_id": allocation.category.parent_id,
                    "is_parent": bool(child_ids),
                    "budget": serialize_decimal(allocation.amount),
                    "spent": serialize_decimal(spent),
                    "own_spent": serialize_decimal(own_spent),
                    "children_spent": serialize_decimal(children_spent),
                    "children_with_budget_spent": serialize_decimal(children_with_budget_spent),
                    "children_without_budget_spent": serialize_decimal(
                        children_without_budget_spent
                    ),
                    "remaining": serialize_decimal(remaining),
                    "usage_rate": serialize_decimal(usage_rate),
                    "notes": allocation.notes,
                }
            )

            # カテゴリ予算合計は二重計上を避ける:
            # 親に予算がある子は親予算で代表されるので合計には加算しない。
            parent_has_budget = (
                allocation.category.parent_id is not None
                and allocation.category.parent_id in budgeted_category_ids
            )
            if not parent_has_budget:
                total_budget += allocation.amount
                total_spent += spent

        # 月全体の実績は予算未設定カテゴリの支出も含む。月上限の評価に使う。
        period_total_spent = HouseholdExpense.objects.filter(
            date__year=year, date__month=month
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")

        return Response(
            {
                "year": year,
                "month": month,
                "period_id": period.id if period else None,
                "period_total_amount": serialize_decimal(period.total_amount if period else None),
                "period_total_spent": serialize_decimal(period_total_spent),
                "total_budget": serialize_decimal(total_budget),
                "total_spent": serialize_decimal(total_spent),
                "items": items,
            }
        )


class AnnualExpenseYearsAPIView(APIView):
    def get(self, request):
        years = (
            HouseholdExpense.objects.values_list("date__year", flat=True)
            .distinct()
            .order_by("-date__year")
        )
        return Response([year for year in years if year is not None])


def _serialize_category(category: HouseholdCategory, child_counts: dict[int, int] | None = None):
    has_children = (
        bool(child_counts.get(category.id))
        if child_counts is not None
        else category.children.exists()
    )
    return {
        "id": category.id,
        "name": category.name,
        "color": category.color,
        "notes": category.notes,
        "parent_id": category.parent_id,
        "has_children": has_children,
    }


class CategoryCreateAPIView(APIView):
    def get(self, request):
        categories = list(HouseholdCategory.objects.order_by("name"))
        child_counts: dict[int, int] = {}
        for category in categories:
            if category.parent_id is not None:
                child_counts[category.parent_id] = child_counts.get(category.parent_id, 0) + 1
        return Response([_serialize_category(category, child_counts) for category in categories])

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        color = (request.data.get("color") or "").strip()
        notes = (request.data.get("notes") or "").strip()
        parent_id = request.data.get("parent_id")

        if not name:
            return Response(
                {"detail": "カテゴリ名は必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if color and not HEX_COLOR_PATTERN.match(color):
            return Response(
                {"detail": "カラーは #RRGGBB 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parent = None
        if parent_id not in (None, ""):
            try:
                parent = HouseholdCategory.objects.get(pk=int(parent_id))
            except (HouseholdCategory.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "親カテゴリが見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if parent.parent_id is not None:
                return Response(
                    {"detail": "カテゴリの階層は2段までです。子カテゴリを親には指定できません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if parent is None:
            if HouseholdCategory.objects.filter(parent__isnull=True, name=name).exists():
                return Response(
                    {"detail": "同じ名前の親なしカテゴリが既に存在します。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            if HouseholdCategory.objects.filter(parent=parent, name=name).exists():
                return Response(
                    {"detail": "同じ親カテゴリ内に同名のカテゴリが存在します。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            category = HouseholdCategory.objects.create(
                name=name,
                color=color,
                notes=notes,
                parent=parent,
            )
        except IntegrityError:
            return Response(
                {"detail": "カテゴリ名が重複しています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(_serialize_category(category), status=status.HTTP_201_CREATED)


class CategoryDetailAPIView(APIView):
    def patch(self, request, category_id: int):
        try:
            category = HouseholdCategory.objects.get(pk=category_id)
        except HouseholdCategory.DoesNotExist:
            return Response(
                {"detail": "カテゴリが見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        name = (request.data.get("name") or category.name).strip()
        # color はキー未送信時のみ現在値を維持。空文字列が来たら「自動」に戻す意図として保存。
        color_raw = request.data.get("color", category.color)
        color = (color_raw or "").strip()
        notes = (request.data.get("notes") or category.notes or "").strip()
        parent_id = request.data.get("parent_id", category.parent_id)

        if not name:
            return Response(
                {"detail": "カテゴリ名は必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if color and not HEX_COLOR_PATTERN.match(color):
            return Response(
                {"detail": "カラーは #RRGGBB 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parent = None
        if parent_id not in (None, ""):
            try:
                parent = HouseholdCategory.objects.get(pk=int(parent_id))
            except (HouseholdCategory.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"detail": "親カテゴリが見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if parent and parent.id == category.id:
            return Response(
                {"detail": "親カテゴリに自身は設定できません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if parent is not None and parent.parent_id is not None:
            return Response(
                {"detail": "カテゴリの階層は2段までです。子カテゴリを親には指定できません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if parent is not None and category.children.exists():
            return Response(
                {"detail": "子カテゴリを持つカテゴリは、別カテゴリの子にできません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if parent is None:
            exists = HouseholdCategory.objects.filter(parent__isnull=True, name=name).exclude(
                id=category.id
            )
            if exists.exists():
                return Response(
                    {"detail": "同じ名前の親なしカテゴリが既に存在します。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            exists = HouseholdCategory.objects.filter(parent=parent, name=name).exclude(
                id=category.id
            )
            if exists.exists():
                return Response(
                    {"detail": "同じ親カテゴリ内に同名のカテゴリが存在します。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        new_parent_id = parent.id if parent is not None else None
        if new_parent_id is not None and new_parent_id != category.parent_id:
            violation = _validate_parent_change_against_budgets(category, parent)
            if violation is not None:
                return violation

        category.name = name
        category.color = color
        category.notes = notes
        category.parent = parent

        try:
            category.save()
        except IntegrityError:
            return Response(
                {"detail": "カテゴリ名が重複しています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(_serialize_category(category))

    def delete(self, request, category_id: int):
        try:
            category = HouseholdCategory.objects.get(pk=category_id)
        except HouseholdCategory.DoesNotExist:
            return Response(
                {"detail": "カテゴリが見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        blockers = []
        expense_count = category.expenses.count()
        if expense_count:
            blockers.append(f"支出 {expense_count} 件")
        allocation_count = category.budget_allocations.count()
        if allocation_count:
            blockers.append(f"予算割当 {allocation_count} 件")
        children_count = category.children.count()
        if children_count:
            blockers.append(f"子カテゴリ {children_count} 件")

        if blockers:
            return Response(
                {
                    "detail": (
                        f"このカテゴリには{'、'.join(blockers)}"
                        "が紐づいているため削除できません。先に整理してください。"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        category.delete()
        return Response({"deleted": 1})


class ExpenseCreateAPIView(APIView):
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


def _validate_parent_change_against_budgets(
    category: HouseholdCategory, new_parent: HouseholdCategory
) -> Response | None:
    """カテゴリを別の親の下へ移すとき、移動先の親予算 ≥ Σ子予算 が崩れないか確認する。

    当該カテゴリが予算を持つ全ての月について、新しい親に同月予算があれば
    ``Σ新しい親の既存子予算 + 当該カテゴリの予算 ≤ 親予算`` を要求する。
    """
    own_allocations = BudgetAllocation.objects.filter(category=category).select_related("period")
    violations: list[str] = []
    for own in own_allocations:
        parent_allocation = BudgetAllocation.objects.filter(
            period=own.period, category=new_parent
        ).first()
        if parent_allocation is None:
            continue
        sibling_total: Decimal = BudgetAllocation.objects.filter(
            period=own.period, category__parent=new_parent
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        if sibling_total + own.amount > parent_allocation.amount:
            violations.append(str(own.period))
    if violations:
        return Response(
            {
                "detail": (
                    f"{'、'.join(violations)} の予算で、移動先の親カテゴリ予算を"
                    "子予算合計が超えてしまいます。先に予算を調整してください。"
                ),
                "code": "child_budget_exceeds_parent",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def _validate_parent_child_budget_constraint(
    category: HouseholdCategory,
    new_amount: Decimal,
    period: BudgetPeriod | None,
    exclude_allocation_id: int | None = None,
) -> Response | None:
    """親予算 ≥ Σ子予算 を保証する。違反したら 400 Response を返す。

    - ``category`` が子のとき: 親に同月予算があれば
      ``Σ既存子予算 (本人除く) + new_amount ≤ 親予算`` を要求。
    - ``category`` が親 (子持ち) のとき:
      ``new_amount ≥ Σ既存子予算`` を要求。

    period が無い (新規作成前) ケースもあるので nullable。
    """
    if period is None:
        # 新規 period 作成時は他予算ゼロなので制約は満たされる。
        return None

    # 子カテゴリの場合: 親に予算があれば合計上限をチェック。
    if category.parent_id is not None:
        parent_allocation = BudgetAllocation.objects.filter(
            period=period, category_id=category.parent_id
        ).first()
        if parent_allocation is not None:
            sibling_total_qs = BudgetAllocation.objects.filter(
                period=period, category__parent_id=category.parent_id
            )
            if exclude_allocation_id is not None:
                sibling_total_qs = sibling_total_qs.exclude(pk=exclude_allocation_id)
            sibling_total: Decimal = sibling_total_qs.aggregate(total=Sum("amount"))[
                "total"
            ] or Decimal("0")
            if sibling_total + new_amount > parent_allocation.amount:
                remaining = parent_allocation.amount - sibling_total
                return Response(
                    {
                        "detail": (
                            f"親カテゴリ予算 {_format_yen(parent_allocation.amount)} 円を"
                            f"子予算合計が超えてしまいます。"
                            f"設定可能金額は {_format_yen(max(remaining, Decimal('0')))} 円まで。"
                        ),
                        "code": "child_budget_exceeds_parent",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return None

    # 親カテゴリの場合: 既存子予算の合計を下回ってはいけない。
    children_total = BudgetAllocation.objects.filter(
        period=period, category__parent_id=category.id
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if new_amount < children_total:
        return Response(
            {
                "detail": (
                    f"子カテゴリ予算の合計 {_format_yen(children_total)} 円を"
                    "下回る親予算は設定できません。"
                ),
                "code": "parent_budget_below_children",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


class BudgetCreateAPIView(APIView):
    def post(self, request):
        year = request.data.get("year")
        month = request.data.get("month")
        category_id = request.data.get("category_id")
        notes = (request.data.get("notes") or "").strip()

        try:
            year = int(year)
            month = int(month)
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

        if not category_id:
            return Response(
                {"detail": "category_idは必須です。"},
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

        period = BudgetPeriod.objects.filter(year=year, month=month).first()

        if (
            period is not None
            and BudgetAllocation.objects.filter(period=period, category=category).exists()
        ):
            return Response(
                {"detail": "同じ月・カテゴリの予算が既に存在します。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        constraint_error = _validate_parent_child_budget_constraint(category, amount, period)
        if constraint_error is not None:
            return constraint_error

        try:
            with transaction.atomic():
                if period is None:
                    period = BudgetPeriod.objects.create(year=year, month=month)

                allocation = BudgetAllocation.objects.create(
                    period=period,
                    category=category,
                    amount=amount,
                    notes=notes,
                )
        except IntegrityError:
            return Response(
                {"detail": "同じ月・カテゴリの予算が既に存在します。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "id": allocation.id,
                "period_id": period.id,
                "year": period.year,
                "month": period.month,
                "category_id": allocation.category_id,
                "amount": serialize_decimal(allocation.amount),
                "notes": allocation.notes,
            },
            status=status.HTTP_201_CREATED,
        )


class BudgetDetailAPIView(APIView):
    def patch(self, request, budget_id: int):
        try:
            allocation = BudgetAllocation.objects.select_related("period").get(pk=budget_id)
        except BudgetAllocation.DoesNotExist:
            return Response(
                {"detail": "予算が見つかりません。"},
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

            exists = BudgetAllocation.objects.filter(
                period=allocation.period,
                category=category,
            ).exclude(id=allocation.id)
            if exists.exists():
                return Response(
                    {"detail": "同じ月・カテゴリの予算が既に存在します。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            allocation.category = category

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
            allocation.amount = amount

        if "notes" in request.data:
            allocation.notes = (request.data.get("notes") or "").strip()

        constraint_error = _validate_parent_child_budget_constraint(
            allocation.category,
            allocation.amount,
            allocation.period,
            exclude_allocation_id=allocation.id,
        )
        if constraint_error is not None:
            return constraint_error

        allocation.save()

        return Response(
            {
                "id": allocation.id,
                "period_id": allocation.period_id,
                "year": allocation.period.year,
                "month": allocation.period.month,
                "category_id": allocation.category_id,
                "amount": serialize_decimal(allocation.amount),
                "notes": allocation.notes,
            }
        )

    def delete(self, request, budget_id: int):
        try:
            allocation = BudgetAllocation.objects.get(pk=budget_id)
        except BudgetAllocation.DoesNotExist:
            return Response(
                {"detail": "予算が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        allocation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _parse_year_month(year_raw, month_raw):
    try:
        year = int(year_raw)
        month = int(month_raw)
    except (TypeError, ValueError):
        return None, "年と月は数値で指定してください。"
    if year < 2000 or year > 2100:
        return None, "年は2000〜2100の範囲で指定してください。"
    if month < 1 or month > 12:
        return None, "月は1から12で指定してください。"
    return (year, month), None


class BudgetPeriodTotalAPIView(APIView):
    """月の総予算 (上限) を設定する。"""

    def put(self, request):
        ym, err = _parse_year_month(request.data.get("year"), request.data.get("month"))
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        raw_amount = request.data.get("total_amount")
        if raw_amount in (None, ""):
            total_amount = None
        else:
            try:
                total_amount = parse_decimal(raw_amount, "total_amount")
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            if total_amount is not None and total_amount < 0:
                return Response(
                    {"detail": "月の総予算は0以上で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        period, _ = BudgetPeriod.objects.get_or_create(year=ym[0], month=ym[1])
        period.total_amount = total_amount
        period.save(update_fields=["total_amount", "updated_at"])

        return Response(
            {
                "period_id": period.id,
                "year": period.year,
                "month": period.month,
                "total_amount": serialize_decimal(period.total_amount),
            }
        )


class BudgetCopyAPIView(APIView):
    """指定月の全カテゴリ予算をターゲット月に複製する。既存はスキップ。"""

    def post(self, request):
        source, err = _parse_year_month(
            request.data.get("source_year"), request.data.get("source_month")
        )
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        target, err = _parse_year_month(
            request.data.get("target_year"), request.data.get("target_month")
        )
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        if source == target:
            return Response(
                {"detail": "コピー元と先が同じ月です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_period = BudgetPeriod.objects.filter(year=source[0], month=source[1]).first()
        if source_period is None:
            return Response(
                {"detail": "コピー元の月に予算がありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_allocations = list(
            BudgetAllocation.objects.filter(period=source_period).select_related("category")
        )
        has_source_total = source_period.total_amount is not None
        if not source_allocations and not has_source_total:
            return Response(
                {"detail": "コピー元の月に予算がありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            target_period, _ = BudgetPeriod.objects.get_or_create(year=target[0], month=target[1])
            existing_allocations = list(
                BudgetAllocation.objects.filter(period=target_period).select_related("category")
            )
            existing_category_ids = {a.category_id for a in existing_allocations}
            new_allocations = [
                BudgetAllocation(
                    period=target_period,
                    category=src.category,
                    amount=src.amount,
                    notes=src.notes,
                )
                for src in source_allocations
                if src.category_id not in existing_category_ids
            ]

            # コピー後に「親予算 ≥ Σ子予算」を満たさなくなる組合せを事前検出して拒否する。
            # bulk_create は save()/clean() を呼ばないため、ここで明示的に確認する必要がある。
            prospective = {
                a.category_id: (a.amount, a.category.parent_id, a.category.name)
                for a in existing_allocations
            }
            for na in new_allocations:
                prospective[na.category.id] = (
                    na.amount,
                    na.category.parent_id,
                    na.category.name,
                )
            violations = []
            for cid, (amount, parent_id, name) in prospective.items():
                if parent_id is not None:
                    continue
                children_sum = sum(
                    (amt for amt, pid, _ in prospective.values() if pid == cid),
                    Decimal("0"),
                )
                if amount < children_sum:
                    violations.append((name, amount, children_sum))
            if violations:
                detail_parts = [
                    f"{name} (親 {_format_yen(p)} 円 < 子合計 {_format_yen(c)} 円)"
                    for name, p, c in violations
                ]
                return Response(
                    {
                        "detail": (
                            "コピーすると親予算が子予算合計を下回るカテゴリが発生します: "
                            + "、".join(detail_parts)
                        ),
                        "code": "parent_budget_below_children",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # ignore_conflicts は同時実行時の保険。通常は existing_category_ids で除外済み。
            BudgetAllocation.objects.bulk_create(new_allocations, ignore_conflicts=True)

            # 月の上限はターゲット未設定のときだけコピー。
            total_amount_copied = False
            if has_source_total and target_period.total_amount is None:
                target_period.total_amount = source_period.total_amount
                target_period.save(update_fields=["total_amount", "updated_at"])
                total_amount_copied = True

        copied = len(new_allocations)
        skipped = len(source_allocations) - copied

        return Response(
            {
                "copied": copied,
                "skipped": skipped,
                "target_period_id": target_period.id,
                "total_amount_copied": total_amount_copied,
            },
            status=status.HTTP_201_CREATED,
        )

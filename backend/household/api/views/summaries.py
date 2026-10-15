"""家計簿の集計: 月次の支出サマリー、予算の使用状況、年次レポートの対象年。"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from household.api.common import serialize_decimal
from household.models import (
    BudgetAllocation,
    BudgetPeriod,
    HouseholdCategory,
    HouseholdExpense,
)


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

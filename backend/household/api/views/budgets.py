"""予算 (カテゴリ別と月の上限) の登録・更新・削除・前月コピー。親予算 ≥ 子予算合計の検証。"""

from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from household.api import schema as H
from household.api.common import _format_yen, _parse_year_month, parse_decimal, serialize_decimal
from household.models import (
    BudgetAllocation,
    BudgetPeriod,
    HouseholdCategory,
)


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
    @extend_schema(
        summary="カテゴリ予算を登録",
        request=H.BudgetIn,
        responses={201: H.BudgetOut, 400: H.DetailOut},
    )
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
    @extend_schema(
        summary="カテゴリ予算を更新",
        request=H.BudgetPatchIn,
        responses={200: H.BudgetOut, 400: H.DetailOut, 404: H.DetailOut},
    )
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

    @extend_schema(summary="カテゴリ予算を削除", responses={204: None, 404: H.DetailOut})
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


class BudgetPeriodTotalAPIView(APIView):
    """月の総予算 (上限) を設定する。"""

    @extend_schema(
        summary="月の上限を設定",
        request=H.PeriodTotalIn,
        responses={200: H.PeriodTotalOut, 400: H.DetailOut},
    )
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

    @extend_schema(
        summary="前月などの予算を別の月へ複製",
        request=H.BudgetCopyIn,
        responses={201: H.BudgetCopyOut, 400: H.DetailOut},
    )
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

"""支出カテゴリ (親子 2 段) の一覧・作成・更新・削除。"""

from __future__ import annotations

from django.db import IntegrityError
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from household.api import schema as H
from household.api.constants import HEX_COLOR_PATTERN
from household.api.views.budgets import _validate_parent_change_against_budgets
from household.models import (
    HouseholdCategory,
)


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
    @extend_schema(summary="カテゴリの一覧", responses={200: H.CategoryOut(many=True)})
    def get(self, request):
        categories = list(HouseholdCategory.objects.order_by("name"))
        child_counts: dict[int, int] = {}
        for category in categories:
            if category.parent_id is not None:
                child_counts[category.parent_id] = child_counts.get(category.parent_id, 0) + 1
        return Response([_serialize_category(category, child_counts) for category in categories])

    @extend_schema(
        summary="カテゴリを作成",
        request=H.CategoryIn,
        responses={201: H.CategoryOut, 400: H.DetailOut},
    )
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
    @extend_schema(
        summary="カテゴリを更新",
        request=H.CategoryIn,
        responses={200: H.CategoryOut, 400: H.DetailOut, 404: H.DetailOut},
    )
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

    @extend_schema(
        summary="カテゴリを削除", responses={200: H.DeletedOut, 400: H.DetailOut, 404: H.DetailOut}
    )
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

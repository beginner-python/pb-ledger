from django.contrib import admin

from commons.admin import AuditAdminMixin

from .models import (
    BudgetAllocation,
    BudgetPeriod,
    HouseholdCategory,
    HouseholdExpense,
)


@admin.register(HouseholdCategory)
class HouseholdCategoryAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "parent")
    search_fields = ("name", "slug", "notes")


@admin.register(BudgetPeriod)
class BudgetPeriodAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("year", "month")
    search_fields = ("notes",)


@admin.register(BudgetAllocation)
class BudgetAllocationAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("period", "category", "amount")
    list_filter = ("period",)
    search_fields = ("category__name", "notes")


@admin.register(HouseholdExpense)
class HouseholdExpenseAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("date", "category", "amount")
    search_fields = ("notes",)
    date_hierarchy = "date"

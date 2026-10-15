from django.urls import path

from .views import (
    AnnualExpenseYearsAPIView,
    BudgetCopyAPIView,
    BudgetCreateAPIView,
    BudgetDetailAPIView,
    BudgetPeriodTotalAPIView,
    CategoryCreateAPIView,
    CategoryDetailAPIView,
    ExpenseCreateAPIView,
    ExpenseDetailAPIView,
    MonthlyBudgetSummaryAPIView,
    MonthlyExpenseSummaryAPIView,
)

urlpatterns = [
    path("categories/", CategoryCreateAPIView.as_view(), name="household_categories"),
    path(
        "categories/<int:category_id>/",
        CategoryDetailAPIView.as_view(),
        name="household_category_detail",
    ),
    path("expenses/", ExpenseCreateAPIView.as_view(), name="household_expenses"),
    path(
        "expenses/<int:expense_id>/",
        ExpenseDetailAPIView.as_view(),
        name="household_expense_detail",
    ),
    path("budgets/", BudgetCreateAPIView.as_view(), name="household_budgets"),
    path("budgets/copy/", BudgetCopyAPIView.as_view(), name="household_budget_copy"),
    path(
        "budgets/period/total/",
        BudgetPeriodTotalAPIView.as_view(),
        name="household_budget_period_total",
    ),
    path(
        "budgets/<int:budget_id>/",
        BudgetDetailAPIView.as_view(),
        name="household_budget_detail",
    ),
    path(
        "expenses/summary/",
        MonthlyExpenseSummaryAPIView.as_view(),
        name="household_expense_summary",
    ),
    path(
        "expenses/years/",
        AnnualExpenseYearsAPIView.as_view(),
        name="household_expense_years",
    ),
    path(
        "budgets/summary/",
        MonthlyBudgetSummaryAPIView.as_view(),
        name="household_budget_summary",
    ),
]

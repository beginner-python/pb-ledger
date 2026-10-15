from django.urls import path

from .views import (
    AccountCsvImportAPIView,
    AccountTransactionsAPIView,
    AssetsAPIView,
    BankAccountCreateAPIView,
    BankAccountCsvTemplateAPIView,
    BankAccountDetailAPIView,
    CashAccountHistoryAPIView,
    CashAdjustmentDetailAPIView,
    CashAdjustmentListCreateAPIView,
    MonthlySummaryAPIView,
    PaymentAccountsAPIView,
    SnapshotCreateAPIView,
    SnapshotDetailAPIView,
    TransferDetailAPIView,
    TransferListCreateAPIView,
)

urlpatterns = [
    path("assets/", AssetsAPIView.as_view(), name="ledger_assets"),
    path(
        "payment-accounts/",
        PaymentAccountsAPIView.as_view(),
        name="ledger_payment_accounts",
    ),
    path("accounts/", BankAccountCreateAPIView.as_view(), name="ledger_accounts_create"),
    path(
        "accounts/<int:account_id>/",
        BankAccountDetailAPIView.as_view(),
        name="ledger_accounts_detail",
    ),
    path(
        "monthly-summary/",
        MonthlySummaryAPIView.as_view(),
        name="ledger_monthly_summary",
    ),
    path(
        "accounts/<int:account_id>/transactions/",
        AccountTransactionsAPIView.as_view(),
        name="ledger_account_transactions",
    ),
    path(
        "accounts/<int:account_id>/csv-templates/",
        BankAccountCsvTemplateAPIView.as_view(),
        name="ledger_account_csv_templates",
    ),
    path(
        "accounts/upload-csv/",
        AccountCsvImportAPIView.as_view(),
        name="ledger_accounts_upload_csv",
    ),
    path("snapshots/", SnapshotCreateAPIView.as_view(), name="ledger_snapshots_create"),
    path(
        "snapshots/<int:snapshot_id>/",
        SnapshotDetailAPIView.as_view(),
        name="ledger_snapshot_detail",
    ),
    path(
        "transfers/",
        TransferListCreateAPIView.as_view(),
        name="ledger_transfers",
    ),
    path(
        "transfers/<int:transfer_id>/",
        TransferDetailAPIView.as_view(),
        name="ledger_transfer_detail",
    ),
    path(
        "cash-adjustments/",
        CashAdjustmentListCreateAPIView.as_view(),
        name="ledger_cash_adjustments",
    ),
    path(
        "cash-adjustments/<int:adjustment_id>/",
        CashAdjustmentDetailAPIView.as_view(),
        name="ledger_cash_adjustment_detail",
    ),
    path(
        "accounts/<int:account_id>/cash-history/",
        CashAccountHistoryAPIView.as_view(),
        name="ledger_account_cash_history",
    ),
]

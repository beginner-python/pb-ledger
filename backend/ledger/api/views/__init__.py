"""ledger の API ビュー。資源ごとのモジュールに分かれており、urls.py からはここ経由で参照する。"""

from .accounts import (
    AccountTransactionsAPIView,
    BankAccountCreateAPIView,
    BankAccountDetailAPIView,
    PaymentAccountsAPIView,
)
from .assets import AssetsAPIView, MonthlySummaryAPIView
from .cash import (
    CashAccountHistoryAPIView,
    CashAdjustmentDetailAPIView,
    CashAdjustmentListCreateAPIView,
)
from .csv import AccountCsvImportAPIView, BankAccountCsvTemplateAPIView
from .snapshots import SnapshotCreateAPIView, SnapshotDetailAPIView
from .transfers import TransferDetailAPIView, TransferListCreateAPIView

__all__ = [
    "AccountCsvImportAPIView",
    "AccountTransactionsAPIView",
    "AssetsAPIView",
    "BankAccountCreateAPIView",
    "BankAccountCsvTemplateAPIView",
    "BankAccountDetailAPIView",
    "CashAccountHistoryAPIView",
    "CashAdjustmentDetailAPIView",
    "CashAdjustmentListCreateAPIView",
    "MonthlySummaryAPIView",
    "PaymentAccountsAPIView",
    "SnapshotCreateAPIView",
    "SnapshotDetailAPIView",
    "TransferDetailAPIView",
    "TransferListCreateAPIView",
]

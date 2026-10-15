"""資産種別 (asset_kind) と決済手段種別の対応、金額の共通定数。"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import DecimalField

from ledger.models import (
    PaymentAccountType,
)

DECIMAL_ZERO = Decimal("0")
MONEY_FIELD = DecimalField(max_digits=14, decimal_places=2)
BANK_ACCOUNT_KIND = "bank_account"
CREDIT_CARD_KIND = "credit_card"
CASH_KIND = "cash"
FINANCIAL_ASSET_KIND = "financial_asset"
PAYMENT_ACCOUNT_KINDS = {BANK_ACCOUNT_KIND, CREDIT_CARD_KIND, CASH_KIND}
VALID_ASSET_KINDS = PAYMENT_ACCOUNT_KINDS | {FINANCIAL_ASSET_KIND}

KIND_TO_PAYMENT_TYPE = {
    BANK_ACCOUNT_KIND: PaymentAccountType.BANK,
    CREDIT_CARD_KIND: PaymentAccountType.CREDIT_CARD,
    CASH_KIND: PaymentAccountType.CASH,
}
PAYMENT_TYPE_TO_KIND = {v: k for k, v in KIND_TO_PAYMENT_TYPE.items()}


type NormalizedHeaderMap = dict[str, int]

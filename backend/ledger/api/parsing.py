"""リクエスト値の解釈 (金額・真偽値・月・資産種別) と、取込で使う例外。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from ledger.api.constants import BANK_ACCOUNT_KIND, VALID_ASSET_KINDS


class InvalidAmountError(ValueError):
    pass


class ColumnResolveError(ValueError):
    pass


def parse_amount(value: str) -> Decimal:
    """Convert a currency string like '160,523' to Decimal or None."""
    if not value:
        raise InvalidAmountError("empty amount")

    normalized = value.replace(",", "").replace("\\", "").replace("¥", "").replace("￥", "").strip()
    if not normalized:
        raise InvalidAmountError("empty amount")

    try:
        return Decimal(normalized)
    except InvalidOperation as exc:
        raise InvalidAmountError(f"invalid amount: {value}") from exc


def parse_amount_or_none(value: str) -> Decimal | None:
    try:
        return parse_amount(value)
    except InvalidAmountError:
        return None


def parse_bool_value(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "t", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "f", "no", "n", "off", ""}:
            return False
    return default


def parse_optional_int(value, *, min_value=None, max_value=None):
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("数値で指定してください。") from exc
    if min_value is not None and parsed < min_value:
        raise ValueError(f"{min_value} 以上で指定してください。")
    if max_value is not None and parsed > max_value:
        raise ValueError(f"{max_value} 以下で指定してください。")
    return parsed


def get_month_range(month_value: str | None) -> tuple[date, date] | None:
    if not month_value:
        today = date.today()
        start = date(today.year, today.month, 1)
    else:
        try:
            year_str, month_str = month_value.split("-")
            year = int(year_str)
            month = int(month_str)
            if not 1 <= month <= 12:
                return None
            start = date(year, month, 1)
        except (ValueError, AttributeError):
            return None

    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)

    return start, end


def normalize_asset_kind(value):
    asset_kind = value or BANK_ACCOUNT_KIND
    return asset_kind if asset_kind in VALID_ASSET_KINDS else None

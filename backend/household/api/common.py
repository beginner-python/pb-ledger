"""金額と年月の解釈・整形の共通処理。"""

from __future__ import annotations

from decimal import Decimal


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

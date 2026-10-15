"""CSV テンプレートに従った明細の取込。列の解決、日付の解釈、再取込時の重複排除。"""

from __future__ import annotations

import csv
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from io import StringIO

from ledger.api.constants import DECIMAL_ZERO, NormalizedHeaderMap
from ledger.api.parsing import ColumnResolveError, parse_amount_or_none
from ledger.models import (
    BankAccount,
    CsvAmountRule,
    CsvTemplate,
    NormalizedTransaction,
)


def normalize_header(value: str) -> str:
    return value.replace("\ufeff", "").strip()


def resolve_column_index(
    column_name: str,
    *,
    has_header: bool,
    header_map: dict[str, int] | None = None,
) -> int:
    if not column_name:
        raise ColumnResolveError("列名が設定されていません。")

    name = normalize_header(column_name)

    if has_header:
        if header_map is None:
            raise ColumnResolveError("header_map が作成されていません。")
        try:
            return header_map[name]
        except KeyError as exc:
            available = "、".join(header_map.keys()) or "（なし）"
            raise ColumnResolveError(
                f"列名: '{column_name}' がCSVに存在しません。 検出された列: {available}"
            ) from exc

    if name.startswith("列"):
        s = name.removeprefix("列")
        if not s.isdigit():
            raise ColumnResolveError("列名の形式が正しくありません。")
        idx = int(s) - 1
        if idx < 0:
            raise ColumnResolveError("列番号は1以上で指定してください。")
        return idx

    if name.isdigit():
        idx = int(name) - 1
        if idx < 0:
            raise ColumnResolveError("列番号は1以上で指定してください。")
        return idx

    raise ColumnResolveError("列名の形式が正しくありません。")


def build_header_map(headers: list[str]) -> NormalizedHeaderMap:
    return {normalize_header(h): i for i, h in enumerate(headers)}


def parse_date_value(value: str, formats: list[str] | None) -> date | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if formats:
        for fmt in formats:
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


# CSV 取込の上限。金融機関の月次明細は数十〜数百行なので十分な余裕を持たせつつ、
# 巨大ファイルで全行をメモリに展開させない。
MAX_CSV_UPLOAD_BYTES = 1 * 1024 * 1024
MAX_CSV_ROWS = 5000
CSV_TOO_LARGE_ERROR = (
    f"CSVファイルは {MAX_CSV_UPLOAD_BYTES // 1024 // 1024} MB 以下にしてください。"
)
CSV_TOO_MANY_ROWS_ERROR = f"CSVは {MAX_CSV_ROWS:,} 行以下にしてください。"


def import_transactions_with_template(
    *,
    account: BankAccount,
    template: CsvTemplate,
    decoded_csv: str,
) -> tuple[int, str | None]:
    if len(decoded_csv.encode("utf-8")) > MAX_CSV_UPLOAD_BYTES:
        return 0, CSV_TOO_LARGE_ERROR
    rows = list(csv.reader(StringIO(decoded_csv)))
    if not rows:
        return 0, "CSVファイルが空です。"
    if len(rows) > MAX_CSV_ROWS:
        return 0, CSV_TOO_MANY_ROWS_ERROR

    has_header = template.has_header
    header_row_index = template.header_row_index if template.header_row_index is not None else 0

    headers: list[str] = []
    if has_header:
        if header_row_index >= len(rows):
            return 0, "CSVヘッダーの行が見つかりません。"
        headers = rows[header_row_index]

    data_start_row = header_row_index + 1 if has_header else header_row_index
    if data_start_row >= len(rows):
        return 0, "登録対象の明細が見つかりませんでした。"

    date_column = template.date_column
    description_column = template.description_column
    balance_column = template.balance_column
    header_map = build_header_map(headers) if has_header else None

    if not date_column:
        return 0, "取引日の列名が設定されていません。"
    try:
        date_index = resolve_column_index(date_column, has_header=has_header, header_map=header_map)
    except ColumnResolveError as e:
        return 0, f"{e}"

    if not description_column:
        return 0, "取引内容の列名が設定されていません。"
    try:
        description_index = resolve_column_index(
            description_column,
            has_header=has_header,
            header_map=header_map,
        )
    except ColumnResolveError as e:
        return 0, f"{e}"

    balance_index: int | None = None
    if balance_column:
        try:
            balance_index = resolve_column_index(
                balance_column, has_header=has_header, header_map=header_map
            )
        except ColumnResolveError as e:
            return 0, f"{e}"

    amount_rule = template.amount_rule
    if amount_rule is None:
        return 0, "入出金判定のルールが未設定です。"

    if amount_rule in (CsvAmountRule.SIGNED, CsvAmountRule.USAGE):
        try:
            signed_index = resolve_column_index(
                template.signed_amount_column,
                has_header=has_header,
                header_map=header_map,
            )
        except ColumnResolveError as e:
            return 0, f"{e}"
        deposit_index = None
        withdrawal_index = None
    else:
        try:
            deposit_index = resolve_column_index(
                template.deposit_column,
                has_header=has_header,
                header_map=header_map,
            )
        except ColumnResolveError as e:
            return 0, f"{e}"

        try:
            withdrawal_index = resolve_column_index(
                template.withdrawal_column,
                has_header=has_header,
                header_map=header_map,
            )
        except ColumnResolveError as e:
            return 0, f"{e}"
        signed_index = None

    def get_cell(row: list[str], index: int | None) -> str:
        if index is None or index < 0:
            return ""
        if index >= len(row):
            return ""
        return row[index].strip()

    created_rows: list[NormalizedTransaction] = []
    date_formats = template.date_formats if isinstance(template.date_formats, list) else []
    candidate_dates: set[date] = set()
    candidate_keys: list[tuple] = []

    for row_index in range(data_start_row, len(rows)):
        row = rows[row_index]
        if not any(cell.strip() for cell in row):
            continue

        date_value = parse_date_value(get_cell(row, date_index), date_formats)
        if date_value is None:
            continue
        candidate_dates.add(date_value)

        amount_value: Decimal | None = None
        if amount_rule == CsvAmountRule.SIGNED:
            amount_value = parse_amount_or_none(get_cell(row, signed_index))
        elif amount_rule == CsvAmountRule.USAGE:
            # 利用額は常に出金（負の値）として保存
            raw = parse_amount_or_none(get_cell(row, signed_index))
            amount_value = -raw if raw is not None else None
        else:
            deposit_value = parse_amount_or_none(get_cell(row, deposit_index)) or DECIMAL_ZERO
            withdrawal_value = parse_amount_or_none(get_cell(row, withdrawal_index)) or DECIMAL_ZERO

            if deposit_value != 0 and withdrawal_value != 0:
                amount_value = deposit_value - withdrawal_value
            elif deposit_value != 0:
                amount_value = deposit_value
            elif withdrawal_value != 0:
                amount_value = -withdrawal_value

        if amount_value is None:
            continue

        balance_value: Decimal | None = (
            parse_amount_or_none(get_cell(row, balance_index))
            if balance_index is not None
            else None
        )
        description_value: str = get_cell(row, description_index)

        key = (
            date_value,
            amount_value,
            balance_value,
            description_value,
        )
        candidate_keys.append(key)

        created_rows.append(
            NormalizedTransaction(
                account=account,
                date=date_value,
                amount=amount_value,
                balance=balance_value,
                description=description_value,
                raw_payload={"row_index": row_index, "row": row},
            )
        )

    # 重複排除は「既存行を 1 行ずつ消費する」方式で行う。
    # 1) 日付・金額・残高・摘要が完全一致する既存行があれば、その行数を上限にスキップ。
    # 2) 摘要だけが違う行は、同じ日付・金額・残高の既存行の残り数を上限にスキップ。
    #    カード会社が CSV の摘要表記を変えた (接頭辞や承認番号の有無など) まま
    #    再取り込みすると、1) をすり抜けて同じ利用が二重登録されるため。
    # ファイル内に完全に同じ行が複数あっても 1 件にはまとめない。カード明細では
    # 同じ店で同日に同額を複数回使った正当な別利用であり、既存行数を超える分だけ
    # 新規登録されるので再取り込みで増殖もしない。
    existing_rows: list[tuple] = []
    if candidate_dates:
        existing_rows = list(
            NormalizedTransaction.objects.filter(
                account=account,
                date__in=candidate_dates,
            ).values_list(
                "date",
                "amount",
                "balance",
                "description",
            )
        )
    existing_exact_counts: Counter[tuple] = Counter(existing_rows)
    existing_group_counts: Counter[tuple] = Counter(key[:3] for key in existing_rows)

    consumed_exact_counts: Counter[tuple] = Counter()
    consumed_group_counts: Counter[tuple] = Counter()
    pending: list[tuple[tuple, NormalizedTransaction]] = []
    for key, row in zip(candidate_keys, created_rows, strict=False):
        if consumed_exact_counts[key] < existing_exact_counts[key]:
            # 完全一致した行は、同じ内容の既存行を 1 つ消費する。
            consumed_exact_counts[key] += 1
            consumed_group_counts[key[:3]] += 1
            continue
        pending.append((key, row))

    filtered_rows: list[NormalizedTransaction] = []
    for key, row in pending:
        group = key[:3]
        if consumed_group_counts[group] < existing_group_counts[group]:
            # 摘要違いの再取り込みとみなしてスキップ。
            consumed_group_counts[group] += 1
            continue
        filtered_rows.append(row)

    NormalizedTransaction.objects.bulk_create(filtered_rows)
    return len(filtered_rows), None

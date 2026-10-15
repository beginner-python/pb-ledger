from __future__ import annotations

import csv
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import StringIO

from django.db import IntegrityError, transaction
from django.db.models import Count, DecimalField, F, ProtectedError, Q, Sum
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.models import (
    AccountBalanceSnapshot,
    BankAccount,
    CashAdjustment,
    CashAdjustmentCategory,
    CashAdjustmentDirection,
    CsvAmountRule,
    CsvTemplate,
    FinancialAsset,
    FinancialAssetSnapshot,
    NormalizedTransaction,
    PaymentAccount,
    PaymentAccountType,
    Transfer,
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


def latest_tx_by_account(as_of):
    qs = NormalizedTransaction.objects.filter(balance__isnull=False)
    if as_of is not None:
        qs = qs.filter(date__lte=as_of)

    return (
        qs.order_by("account_id", "-date", "-id")
        .distinct("account_id")
        .values("account_id", "balance", "date")
    )


def latest_snapshot_by_account(as_of):
    qs = AccountBalanceSnapshot.objects.all()
    if as_of is not None:
        qs = qs.filter(as_of__lte=as_of)

    return (
        qs.order_by("account_id", "-as_of", "-id")
        .distinct("account_id")
        .values("account_id", "balance", "as_of")
    )


def latest_financial_asset_snapshot_by_asset(as_of):
    qs = FinancialAssetSnapshot.objects.all()
    if as_of is not None:
        qs = qs.filter(as_of__lte=as_of)

    return (
        qs.order_by("financial_asset_id", "-as_of", "-id")
        .distinct("financial_asset_id")
        .values("financial_asset_id", "amount", "as_of")
    )


def choose_balance(tx_row, snap_row):
    """
    tx_row: {"account_id":..., "balance":..., "date":...} or None
    snap_row: {"account_id":..., "balance":..., "as_of":...} or None
    """
    if tx_row and snap_row:
        if snap_row["as_of"] >= tx_row["date"]:
            return snap_row["balance"], snap_row["as_of"], "snapshot"
        return tx_row["balance"], tx_row["date"], "transaction"

    if snap_row:
        return snap_row["balance"], snap_row["as_of"], "snapshot"
    if tx_row:
        return tx_row["balance"], tx_row["date"], "transaction"
    return None, None, "none"


def normalize_asset_kind(value):
    asset_kind = value or BANK_ACCOUNT_KIND
    return asset_kind if asset_kind in VALID_ASSET_KINDS else None


def snapshot_payload(snapshot, asset_kind):
    if asset_kind == FINANCIAL_ASSET_KIND:
        return {
            "id": snapshot.id,
            "asset_kind": asset_kind,
            "account_id": snapshot.financial_asset_id,
            "as_of": snapshot.as_of.isoformat(),
            "balance": str(snapshot.amount),
            "notes": snapshot.notes,
        }
    return {
        "id": snapshot.id,
        "asset_kind": asset_kind,
        "account_id": snapshot.account_id,
        "as_of": snapshot.as_of.isoformat(),
        "balance": str(snapshot.balance),
        "notes": snapshot.notes,
    }


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


def serialize_transfer(transfer: Transfer) -> dict:
    return {
        "id": transfer.id,
        "date": transfer.date.isoformat(),
        "amount": str(transfer.amount),
        "from_account_id": transfer.from_account_id,
        "to_account_id": transfer.to_account_id,
        "from_transaction_id": transfer.from_transaction_id,
        "to_transaction_id": transfer.to_transaction_id,
        "notes": transfer.notes,
    }


def _validate_transfer_transaction_link(
    *,
    tx: NormalizedTransaction,
    side: str,  # "from" or "to"
    account_id: int,
    exclude_transfer_id: int | None = None,
) -> tuple[str, int] | None:
    """振替に明細を紐付ける際の整合性をチェックする。

    問題があれば (error_message, http_status)、無ければ None を返す。
    """
    from household.models import HouseholdExpense

    # tx の口座と Transfer 側の口座が一致しているか
    if tx.account_id != account_id:
        label = "送金元" if side == "from" else "送金先"
        return (
            f"明細の口座と{label}口座が一致しません。",
            status.HTTP_400_BAD_REQUEST,
        )

    # 既に別の Transfer が同じ明細を同じ向きで参照していないか
    if side == "from":
        dup_qs = Transfer.objects.filter(from_transaction_id=tx.id)
    else:
        dup_qs = Transfer.objects.filter(to_transaction_id=tx.id)
    if exclude_transfer_id is not None:
        dup_qs = dup_qs.exclude(id=exclude_transfer_id)
    if dup_qs.exists():
        return (
            "この明細は既に別の振替と紐付いています。",
            status.HTTP_409_CONFLICT,
        )

    # この明細が既に家計支出と紐付いていたら振替には使えない
    if HouseholdExpense.objects.filter(source_transaction_id=tx.id).exists():
        return (
            "この明細は家計支出と紐付いているため振替には使えません。",
            status.HTTP_409_CONFLICT,
        )

    return None


class TransferListCreateAPIView(APIView):
    def get(self, request):
        month_value = request.query_params.get("month")
        qs = Transfer.objects.all()
        if month_value:
            month_range = get_month_range(month_value)
            if month_range is None:
                return Response(
                    {"error": "month は YYYY-MM 形式で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            start, end = month_range
            qs = qs.filter(date__gte=start, date__lt=end)

        # 明細未紐付けの振替候補を取得するためのフィルタ。
        # 銀行明細起点で「既存の振替と紐付け」する際に使う。
        unlinked_from = request.query_params.get(
            "unlinked_from_account_id"
        ) or request.query_params.get("unlinkedFromAccountId")
        if unlinked_from:
            qs = qs.filter(from_account_id=unlinked_from, from_transaction__isnull=True)
        unlinked_to = request.query_params.get(
            "unlinked_to_account_id"
        ) or request.query_params.get("unlinkedToAccountId")
        if unlinked_to:
            qs = qs.filter(to_account_id=unlinked_to, to_transaction__isnull=True)

        transfers = qs.order_by("-date", "-id")
        return Response({"transfers": [serialize_transfer(t) for t in transfers]})

    def post(self, request):
        date_value = request.data.get("date")
        from_account_id = request.data.get("from_account_id") or request.data.get("fromAccountId")
        to_account_id = request.data.get("to_account_id") or request.data.get("toAccountId")
        from_transaction_id = request.data.get("from_transaction_id") or request.data.get(
            "fromTransactionId"
        )
        to_transaction_id = request.data.get("to_transaction_id") or request.data.get(
            "toTransactionId"
        )
        notes = (request.data.get("notes") or "").strip()

        if not date_value or not from_account_id or not to_account_id:
            return Response(
                {"error": "date, from_account_id, to_account_id は必須です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            parsed_date = date.fromisoformat(str(date_value))
        except (ValueError, TypeError):
            return Response(
                {"error": "日付の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            amount = parse_amount(str(request.data.get("amount") or ""))
        except InvalidAmountError:
            return Response(
                {"error": "金額の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if from_account_id == to_account_id:
            return Response(
                {"error": "送金元と送金先は異なる口座を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not PaymentAccount.objects.filter(id=from_account_id).exists():
            return Response(
                {"error": "送金元の口座が見つかりません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not PaymentAccount.objects.filter(id=to_account_id).exists():
            return Response(
                {"error": "送金先の口座が見つかりません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from_transaction = None
        if from_transaction_id:
            try:
                from_transaction = NormalizedTransaction.objects.get(id=from_transaction_id)
            except NormalizedTransaction.DoesNotExist:
                return Response(
                    {"error": "送金元明細が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            err = _validate_transfer_transaction_link(
                tx=from_transaction,
                side="from",
                account_id=int(from_account_id),
            )
            if err is not None:
                msg, code = err
                return Response({"error": msg}, status=code)

        to_transaction = None
        if to_transaction_id:
            try:
                to_transaction = NormalizedTransaction.objects.get(id=to_transaction_id)
            except NormalizedTransaction.DoesNotExist:
                return Response(
                    {"error": "送金先明細が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            err = _validate_transfer_transaction_link(
                tx=to_transaction,
                side="to",
                account_id=int(to_account_id),
            )
            if err is not None:
                msg, code = err
                return Response({"error": msg}, status=code)

        transfer = Transfer.objects.create(
            date=parsed_date,
            amount=amount,
            from_account_id=from_account_id,
            to_account_id=to_account_id,
            from_transaction=from_transaction,
            to_transaction=to_transaction,
            notes=notes,
        )
        return Response(serialize_transfer(transfer), status=status.HTTP_201_CREATED)


class TransferDetailAPIView(APIView):
    def delete(self, request, transfer_id):
        deleted, _ = Transfer.objects.filter(id=transfer_id).delete()
        if deleted == 0:
            return Response(
                {"error": "振替が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"deleted": 1})

    def patch(self, request, transfer_id):
        try:
            transfer = Transfer.objects.get(id=transfer_id)
        except Transfer.DoesNotExist:
            return Response(
                {"error": "振替が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if "date" in request.data:
            try:
                transfer.date = date.fromisoformat(str(request.data["date"]))
            except (ValueError, TypeError):
                return Response(
                    {"error": "日付の形式が正しくありません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if "amount" in request.data:
            try:
                transfer.amount = parse_amount(str(request.data["amount"]))
            except InvalidAmountError:
                return Response(
                    {"error": "金額の形式が正しくありません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if "notes" in request.data:
            transfer.notes = (request.data.get("notes") or "").strip()

        if "from_account_id" in request.data or "fromAccountId" in request.data:
            new_from = request.data.get("from_account_id") or request.data.get("fromAccountId")
            if not PaymentAccount.objects.filter(id=new_from).exists():
                return Response(
                    {"error": "送金元の口座が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            transfer.from_account_id = new_from

        if "to_account_id" in request.data or "toAccountId" in request.data:
            new_to = request.data.get("to_account_id") or request.data.get("toAccountId")
            if not PaymentAccount.objects.filter(id=new_to).exists():
                return Response(
                    {"error": "送金先の口座が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            transfer.to_account_id = new_to

        if transfer.from_account_id == transfer.to_account_id:
            return Response(
                {"error": "送金元と送金先は異なる口座を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for attr, key, camel_key, side, account_attr in (
            (
                "from_transaction",
                "from_transaction_id",
                "fromTransactionId",
                "from",
                "from_account_id",
            ),
            (
                "to_transaction",
                "to_transaction_id",
                "toTransactionId",
                "to",
                "to_account_id",
            ),
        ):
            if key not in request.data and camel_key not in request.data:
                continue
            value = request.data.get(key) or request.data.get(camel_key)
            if value in (None, "", 0):
                setattr(transfer, attr, None)
                continue
            try:
                tx = NormalizedTransaction.objects.get(id=value)
            except NormalizedTransaction.DoesNotExist:
                return Response(
                    {"error": f"{attr}に対応する明細が見つかりません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            err = _validate_transfer_transaction_link(
                tx=tx,
                side=side,
                account_id=getattr(transfer, account_attr),
                exclude_transfer_id=transfer.id,
            )
            if err is not None:
                msg, code = err
                return Response({"error": msg}, status=code)
            setattr(transfer, attr, tx)

        transfer.save()
        return Response(serialize_transfer(transfer))


def serialize_cash_adjustment(adj: CashAdjustment) -> dict:
    return {
        "id": adj.id,
        "payment_account_id": adj.payment_account_id,
        "date": adj.date.isoformat(),
        "direction": adj.direction,
        "amount": str(adj.amount),
        "category": adj.category,
        "counterparty_name": adj.counterparty_name,
        "notes": adj.notes,
    }


VALID_CASH_DIRECTIONS = {d.value for d in CashAdjustmentDirection}
VALID_CASH_CATEGORIES = {c.value for c in CashAdjustmentCategory}


def _parse_cash_adjustment_payload(data, *, partial: bool = False):
    """request.data から CashAdjustment 用の値を取り出して検証する。"""
    result: dict = {}

    def has(key, alt=None):
        return key in data or (alt is not None and alt in data)

    def get(key, alt=None):
        return data.get(key) if key in data else data.get(alt)

    if has("payment_account_id", "paymentAccountId") or not partial:
        pa_id = get("payment_account_id", "paymentAccountId")
        if not pa_id:
            return None, "現金口座は必須です。"
        try:
            account = PaymentAccount.objects.get(id=pa_id)
        except PaymentAccount.DoesNotExist:
            return None, "現金口座が見つかりません。"
        if account.type != PaymentAccountType.CASH:
            return None, "現金口座を指定してください。"
        result["payment_account_id"] = account.id

    if has("date") or not partial:
        date_value = get("date")
        if not date_value:
            return None, "日付は必須です。"
        try:
            result["date"] = date.fromisoformat(str(date_value))
        except (ValueError, TypeError):
            return None, "日付の形式が正しくありません。"

    if has("direction") or not partial:
        direction = get("direction")
        if direction not in VALID_CASH_DIRECTIONS:
            return None, "方向は in / out で指定してください。"
        result["direction"] = direction

    if has("amount") or not partial:
        try:
            amount = parse_amount(str(get("amount") or ""))
        except InvalidAmountError:
            return None, "金額の形式が正しくありません。"
        if amount <= 0:
            return None, "金額は0より大きい値を指定してください。"
        result["amount"] = amount

    if has("category") or not partial:
        category = get("category") or CashAdjustmentCategory.OTHER.value
        if category not in VALID_CASH_CATEGORIES:
            return None, "種別の値が正しくありません。"
        result["category"] = category

    if has("counterparty_name", "counterpartyName"):
        result["counterparty_name"] = (get("counterparty_name", "counterpartyName") or "").strip()[
            :100
        ]

    if has("notes"):
        result["notes"] = (get("notes") or "").strip()[:255]

    return result, None


class CashAdjustmentListCreateAPIView(APIView):
    def get(self, request):
        qs = CashAdjustment.objects.all()
        account_id = request.query_params.get("payment_account_id") or request.query_params.get(
            "paymentAccountId"
        )
        if account_id:
            qs = qs.filter(payment_account_id=account_id)
        month_value = request.query_params.get("month")
        if month_value:
            month_range = get_month_range(month_value)
            if month_range is None:
                return Response(
                    {"error": "month は YYYY-MM 形式で指定してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            start, end = month_range
            qs = qs.filter(date__gte=start, date__lt=end)
        adjustments = qs.order_by("-date", "-id")
        return Response(
            {
                "adjustments": [serialize_cash_adjustment(a) for a in adjustments],
            }
        )

    def post(self, request):
        parsed, error = _parse_cash_adjustment_payload(request.data, partial=False)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        adjustment = CashAdjustment.objects.create(**parsed)
        return Response(serialize_cash_adjustment(adjustment), status=status.HTTP_201_CREATED)


class CashAdjustmentDetailAPIView(APIView):
    def patch(self, request, adjustment_id):
        try:
            adjustment = CashAdjustment.objects.get(id=adjustment_id)
        except CashAdjustment.DoesNotExist:
            return Response(
                {"error": "現金の入出記録が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        parsed, error = _parse_cash_adjustment_payload(request.data, partial=True)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        for attr, value in parsed.items():
            setattr(adjustment, attr, value)
        adjustment.save()
        return Response(serialize_cash_adjustment(adjustment))

    def delete(self, request, adjustment_id):
        deleted, _ = CashAdjustment.objects.filter(id=adjustment_id).delete()
        if deleted == 0:
            return Response(
                {"error": "現金の入出記録が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"deleted": 1})


class PaymentAccountsAPIView(APIView):
    """支払元として選択可能な全 PaymentAccount を返す。家計支出の選択肢用。"""

    def get(self, request):
        accounts = (
            PaymentAccount.objects.filter(is_archived=False)
            .order_by("type", "display_order", "id")
            .values("id", "name", "type")
        )
        return Response(
            {
                "accounts": [
                    {
                        "id": account["id"],
                        "name": account["name"],
                        "type": account["type"],
                        "kind": PAYMENT_TYPE_TO_KIND[account["type"]],
                    }
                    for account in accounts
                ]
            }
        )


class MonthlySummaryAPIView(APIView):
    def get(self, request):
        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        per_account = (
            NormalizedTransaction.objects.filter(date__gte=start, date__lt=end_exclusive)
            # 振替済の明細は資金移動であり収支ではないため除外する
            .exclude_transfer_linked()
            .values("account_id")
            .annotate(
                income=Sum("amount", filter=Q(amount__gt=0), default=0),
                expense=Sum(-F("amount"), filter=Q(amount__lt=0), default=0),
            )
        )

        accounts_payload = []
        total_income = DECIMAL_ZERO
        total_expense = DECIMAL_ZERO

        per_account_map = {row["account_id"]: row for row in per_account}

        for account in BankAccount.objects.order_by("display_order", "id").values("id"):
            row = per_account_map.get(account["id"])
            income = row["income"] if row else DECIMAL_ZERO
            expense = row["expense"] if row else DECIMAL_ZERO

            total_income += income
            total_expense += expense

            accounts_payload.append(
                {
                    "account_id": account["id"],
                    "income": str(income),
                    "expense": str(expense),
                }
            )

        return Response(
            {
                "total_income": str(total_income),
                "total_expense": str(total_expense),
                "accounts": accounts_payload,
            }
        )


def compute_cash_balance(account_id, as_of: date) -> tuple[Decimal | None, date | None, str]:
    """
    現金口座の残高を「最新スナップショット ± その後の Transfer / Expense / CashAdjustment」
    で動的に計算する。スナップショットが無い場合でも、明細(振替/支出/入出)を合算した値を返す。
    """
    from household.models import HouseholdExpense

    snap = (
        AccountBalanceSnapshot.objects.filter(account_id=account_id, as_of__lte=as_of)
        .order_by("-as_of", "-id")
        .first()
    )
    base_balance = snap.balance if snap else DECIMAL_ZERO
    base_date = snap.as_of if snap else None

    transfer_qs = Transfer.objects.filter(date__lte=as_of)
    # CashAdjustment 由来の Expense は adjustment 側で既に残高に反映済みのため除外
    expense_qs = HouseholdExpense.objects.filter(
        payment_account_id=account_id,
        date__lte=as_of,
        source_cash_adjustment__isnull=True,
    )
    adj_qs = CashAdjustment.objects.filter(payment_account_id=account_id, date__lte=as_of)
    if base_date is not None:
        transfer_qs = transfer_qs.filter(date__gt=base_date)
        expense_qs = expense_qs.filter(date__gt=base_date)
        adj_qs = adj_qs.filter(date__gt=base_date)

    transfers_in = (
        transfer_qs.filter(to_account_id=account_id).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    transfers_out = (
        transfer_qs.filter(from_account_id=account_id).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    expenses_out = expense_qs.aggregate(total=Sum("amount"))["total"] or DECIMAL_ZERO
    adj_in = (
        adj_qs.filter(direction=CashAdjustmentDirection.IN).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    adj_out = (
        adj_qs.filter(direction=CashAdjustmentDirection.OUT).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )

    balance = base_balance + transfers_in - transfers_out - expenses_out + adj_in - adj_out
    has_any_activity = (
        snap is not None or transfers_in or transfers_out or expenses_out or adj_in or adj_out
    )
    if not has_any_activity:
        return None, None, "none"

    # last_updated は「最新の動き」の日付を採用する
    last_dates = [
        d
        for d in [
            base_date,
            transfer_qs.order_by("-date").values_list("date", flat=True).first(),
            expense_qs.order_by("-date").values_list("date", flat=True).first(),
            adj_qs.order_by("-date").values_list("date", flat=True).first(),
        ]
        if d is not None
    ]
    last_updated = max(last_dates) if last_dates else None
    source = "snapshot" if snap else "computed"
    return balance, last_updated, source


def compute_credit_card_monthly_usage(card_id, year: int, month: int) -> Decimal:
    """
    クレジットカードの「その月の利用額」を取引から動的計算する。

    利用額 = -Σ(カード明細の amount for date in [year-month])

    前提:
    - カード明細 (NormalizedTransaction) の amount は出金 = 負の値
      （CSV テンプレートで利用額を withdrawal_column に設定した場合）

    締め日は考慮しない。利用日が選択月に入る charge のみを合算する
    （= ユーザがその月に使った合計）。引落 Transfer は利用額と無関係なので除外。
    """
    charges_sum = (
        NormalizedTransaction.objects.filter(
            account_id=card_id, date__year=year, date__month=month
        ).aggregate(total=Sum("amount"))["total"]
        or DECIMAL_ZERO
    )
    return -charges_sum


def _previous_year_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def build_payment_account_payload(
    *,
    account,
    kind,
    tx_now_map,
    snap_now_map,
    tx_prev_map,
    snap_prev_map,
    current_month_start: date,
    current_month_end: date,
    previous_month_end: date,
):
    if kind == CREDIT_CARD_KIND:
        balance = compute_credit_card_monthly_usage(
            account.id, current_month_start.year, current_month_start.month
        )
        prev_year, prev_month = _previous_year_month(
            current_month_start.year, current_month_start.month
        )
        previous_balance = compute_credit_card_monthly_usage(account.id, prev_year, prev_month)
        last_updated = current_month_end
        source = "computed"
    elif kind == CASH_KIND:
        balance, last_updated, source = compute_cash_balance(account.id, current_month_end)
        previous_balance, _, _ = compute_cash_balance(account.id, previous_month_end)
    else:
        balance, last_updated, source = choose_balance(
            tx_now_map.get(account.id),
            snap_now_map.get(account.id),
        )
        previous_balance, _, _ = choose_balance(
            tx_prev_map.get(account.id),
            snap_prev_map.get(account.id),
        )

    balance_change = None
    if balance is not None and previous_balance is not None:
        balance_change = balance - previous_balance

    return (
        {
            "asset_kind": kind,
            "account_id": account.id,
            "account_name": account.name,
            "balance": str(balance) if balance is not None else None,
            "previous_balance": str(previous_balance) if previous_balance is not None else None,
            "balance_change": str(balance_change) if balance_change is not None else None,
            "last_updated": last_updated.isoformat() if last_updated else None,
            "source": source,
            "has_csv_template": bool(account.default_csv_template_id),
            "csv_template_id": account.default_csv_template_id,
            "reference_url": account.reference_url,
        },
        balance,
        previous_balance,
    )


class AssetsAPIView(APIView):
    def get(self, request):
        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_month_start, current_month_end_exclusive = month_range
        current_month_end = current_month_end_exclusive - timedelta(days=1)
        previous_month_end = current_month_start - timedelta(days=1)

        payment_accounts = list(PaymentAccount.objects.all().order_by("display_order", "id"))
        financial_assets = list(FinancialAsset.objects.all().order_by("display_order", "id"))

        tx_now = {r["account_id"]: r for r in latest_tx_by_account(current_month_end)}
        snap_now = {r["account_id"]: r for r in latest_snapshot_by_account(current_month_end)}
        tx_prev = {r["account_id"]: r for r in latest_tx_by_account(previous_month_end)}
        snap_prev = {r["account_id"]: r for r in latest_snapshot_by_account(previous_month_end)}

        payloads_by_type: dict[str, list] = {
            BANK_ACCOUNT_KIND: [],
            CREDIT_CARD_KIND: [],
            CASH_KIND: [],
        }
        totals_now = {k: DECIMAL_ZERO for k in payloads_by_type}
        totals_prev = {k: DECIMAL_ZERO for k in payloads_by_type}

        for account in payment_accounts:
            kind = PAYMENT_TYPE_TO_KIND[account.type]
            payload, balance, previous_balance = build_payment_account_payload(
                account=account,
                kind=kind,
                tx_now_map=tx_now,
                snap_now_map=snap_now,
                tx_prev_map=tx_prev,
                snap_prev_map=snap_prev,
                current_month_start=current_month_start,
                current_month_end=current_month_end,
                previous_month_end=previous_month_end,
            )
            payloads_by_type[kind].append(payload)
            if balance is not None:
                totals_now[kind] += balance
            if previous_balance is not None:
                totals_prev[kind] += previous_balance

        financial_assets_payload = []
        financial_assets_total = DECIMAL_ZERO
        financial_assets_total_previous = DECIMAL_ZERO

        financial_snap_now = {
            r["financial_asset_id"]: r
            for r in latest_financial_asset_snapshot_by_asset(current_month_end)
        }
        financial_snap_prev = {
            r["financial_asset_id"]: r
            for r in latest_financial_asset_snapshot_by_asset(previous_month_end)
        }

        for financial_asset in financial_assets:
            snap_now_row = financial_snap_now.get(financial_asset.id)
            snap_prev_row = financial_snap_prev.get(financial_asset.id)
            balance = snap_now_row["amount"] if snap_now_row else None
            previous_balance = snap_prev_row["amount"] if snap_prev_row else None
            last_updated = snap_now_row["as_of"] if snap_now_row else None
            source = "snapshot" if snap_now_row else "none"

            balance_change = None
            if balance is not None and previous_balance is not None:
                balance_change = balance - previous_balance

            if balance is not None:
                financial_assets_total += balance
            if previous_balance is not None:
                financial_assets_total_previous += previous_balance

            financial_assets_payload.append(
                {
                    "asset_kind": FINANCIAL_ASSET_KIND,
                    "account_id": financial_asset.id,
                    "account_name": financial_asset.name,
                    "balance": str(balance) if balance is not None else None,
                    "previous_balance": str(previous_balance)
                    if previous_balance is not None
                    else None,
                    "balance_change": str(balance_change) if balance_change is not None else None,
                    "last_updated": last_updated.isoformat() if last_updated else None,
                    "source": source,
                    "has_csv_template": False,
                    "csv_template_id": None,
                    "reference_url": financial_asset.reference_url,
                }
            )

        bank_accounts_total = totals_now[BANK_ACCOUNT_KIND]
        bank_accounts_total_previous = totals_prev[BANK_ACCOUNT_KIND]
        credit_cards_total = totals_now[CREDIT_CARD_KIND]
        credit_cards_total_previous = totals_prev[CREDIT_CARD_KIND]
        cash_wallets_total = totals_now[CASH_KIND]
        cash_wallets_total_previous = totals_prev[CASH_KIND]

        # 資産管理の対象は銀行・現金・金融資産のみ。
        # クレジットカードは別画面で当月利用額を管理するため、ここでは合算しない。
        total_assets = bank_accounts_total + cash_wallets_total + financial_assets_total
        total_assets_previous = (
            bank_accounts_total_previous
            + cash_wallets_total_previous
            + financial_assets_total_previous
        )

        return Response(
            {
                "total_assets": str(total_assets),
                "total_assets_change": str(total_assets - total_assets_previous),
                "bank_accounts_total": str(bank_accounts_total),
                "bank_accounts_total_change": str(
                    bank_accounts_total - bank_accounts_total_previous
                ),
                "credit_cards_total": str(credit_cards_total),
                "credit_cards_total_change": str(credit_cards_total - credit_cards_total_previous),
                "cash_wallets_total": str(cash_wallets_total),
                "cash_wallets_total_change": str(cash_wallets_total - cash_wallets_total_previous),
                "financial_assets_total": str(financial_assets_total),
                "financial_assets_total_change": str(
                    financial_assets_total - financial_assets_total_previous
                ),
                "previous_month_end": previous_month_end.isoformat(),
                "bank_accounts": payloads_by_type[BANK_ACCOUNT_KIND],
                "credit_cards": payloads_by_type[CREDIT_CARD_KIND],
                "cash_wallets": payloads_by_type[CASH_KIND],
                "financial_assets": financial_assets_payload,
            }
        )


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


class BankAccountCreateAPIView(APIView):
    def post(self, request):
        asset_kind = normalize_asset_kind(
            request.data.get("asset_kind") or request.data.get("assetKind")
        )
        name = (request.data.get("name") or "").strip()

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not name:
            return Response(
                {"error": "名前を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            FinancialAsset.objects.create(name=name)
            return Response({"created": 1}, status=status.HTTP_201_CREATED)

        # PaymentAccount 系（銀行/クレカ/現金）
        payment_type = KIND_TO_PAYMENT_TYPE[asset_kind]
        kwargs = {"type": payment_type, "name": name}

        if asset_kind == BANK_ACCOUNT_KIND:
            kwargs["branch_name"] = (request.data.get("branch_name") or "").strip()
            kwargs["account_number"] = (request.data.get("account_number") or "").strip()

        if asset_kind == CREDIT_CARD_KIND:
            kwargs["issuer"] = (request.data.get("issuer") or "").strip()
            last4 = (request.data.get("last4") or "").strip()
            if last4 and not last4.isdigit():
                return Response(
                    {"error": "下4桁は数字で入力してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kwargs["last4"] = last4
            try:
                closing_day = parse_optional_int(
                    request.data.get("closing_day"), min_value=1, max_value=31
                )
                payment_day = parse_optional_int(
                    request.data.get("payment_day"), min_value=1, max_value=31
                )
            except ValueError as exc:
                return Response(
                    {"error": f"締め日/引落日は {exc}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kwargs["closing_day"] = closing_day
            kwargs["payment_day"] = payment_day

            payment_destination_id = request.data.get("payment_destination_id") or request.data.get(
                "paymentDestinationId"
            )
            if payment_destination_id:
                if not BankAccount.objects.filter(id=payment_destination_id).exists():
                    return Response(
                        {"error": "引落先の銀行口座が見つかりません。"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                kwargs["payment_destination_id"] = payment_destination_id

        PaymentAccount.objects.create(**kwargs)
        return Response({"created": 1}, status=status.HTTP_201_CREATED)


class BankAccountDetailAPIView(APIView):
    def delete(self, request, account_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )
        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                financial_asset = FinancialAsset.objects.get(id=account_id)
            except FinancialAsset.DoesNotExist:
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            deleted_snapshots = FinancialAssetSnapshot.objects.filter(
                financial_asset_id=account_id
            ).count()
            financial_asset.delete()
            return Response(
                {
                    "deleted": 1,
                    "deleted_transactions": 0,
                    "deleted_snapshots": deleted_snapshots,
                }
            )

        try:
            account = PaymentAccount.objects.get(
                id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        deleted_transactions = NormalizedTransaction.objects.filter(account_id=account_id).count()
        deleted_snapshots = AccountBalanceSnapshot.objects.filter(account_id=account_id).count()

        # Transfer / CashAdjustment は PROTECT なので、紐付きがあると削除できない。
        blockers = []
        transfer_count = Transfer.objects.filter(
            Q(from_account_id=account_id) | Q(to_account_id=account_id)
        ).count()
        if transfer_count:
            blockers.append(f"振替 {transfer_count} 件")
        adjustment_count = CashAdjustment.objects.filter(payment_account_id=account_id).count()
        if adjustment_count:
            blockers.append(f"現金の入出 {adjustment_count} 件")
        if blockers:
            return Response(
                {
                    "error": (
                        f"この口座には{'、'.join(blockers)}が紐づいているため"
                        "削除できません。先に整理してください。"
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            account.delete()
        except ProtectedError:
            return Response(
                {"error": "この口座は他の記録から参照されているため削除できません。"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {
                "deleted": 1,
                "deleted_transactions": deleted_transactions,
                "deleted_snapshots": deleted_snapshots,
            }
        )

    def patch(self, request, account_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind")
            or request.query_params.get("assetKind")
            or request.data.get("asset_kind")
            or request.data.get("assetKind")
        )
        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                account = FinancialAsset.objects.get(id=account_id)
            except FinancialAsset.DoesNotExist:
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            try:
                account = PaymentAccount.objects.get(
                    id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
                )
            except PaymentAccount.DoesNotExist:
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        update_fields: list[str] = []

        if "reference_url" in request.data or "referenceUrl" in request.data:
            reference_url = (
                request.data.get("reference_url") or request.data.get("referenceUrl") or ""
            ).strip()
            if len(reference_url) > 500:
                return Response(
                    {"error": "URLが長すぎます。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            account.reference_url = reference_url
            update_fields.append("reference_url")

        if update_fields:
            account.save(update_fields=update_fields)

        return Response(
            {
                "account_id": account.id,
                "reference_url": account.reference_url,
            }
        )


class AccountTransactionsAPIView(APIView):
    def get(self, request, account_id):
        if not PaymentAccount.objects.filter(id=account_id).exists():
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        limit = request.query_params.get("limit")
        try:
            limit_value = int(limit) if limit is not None else 50
        except (TypeError, ValueError):
            limit_value = 50
        limit_value = max(1, min(limit_value, 200))

        transactions = list(
            NormalizedTransaction.objects.filter(
                account_id=account_id, date__gte=start, date__lt=end_exclusive
            )
            .annotate(
                linked_expense_total=Sum("expenses__amount"),
                linked_expense_count=Count("expenses"),
            )
            .order_by("-date", "-id")[:limit_value]
        )

        tx_ids = [tx.id for tx in transactions]
        # 各 tx に紐付く Transfer (送金元側 or 送金先側) を取得
        transfer_by_from_tx: dict[int, Transfer] = {
            t.from_transaction_id: t
            for t in Transfer.objects.filter(from_transaction_id__in=tx_ids).select_related(
                "to_account"
            )
        }
        transfer_by_to_tx: dict[int, Transfer] = {
            t.to_transaction_id: t
            for t in Transfer.objects.filter(to_transaction_id__in=tx_ids).select_related(
                "from_account"
            )
        }

        payload = []
        for tx in transactions:
            linked_total = tx.linked_expense_total or DECIMAL_ZERO
            linked_transfer_id: int | None = None
            linked_transfer_amount: str | None = None
            linked_transfer_direction: str | None = None
            linked_transfer_other_account_id: int | None = None
            linked_transfer_other_account_name: str | None = None
            linked_transfer_date: str | None = None
            linked_transfer_notes: str | None = None
            # 片側だけ紐付いた振替で、反対側の明細が未設定なら完成待ち。
            linked_transfer_opposite_free = False

            tr = transfer_by_from_tx.get(tx.id)
            if tr is not None:
                linked_transfer_id = tr.id
                linked_transfer_amount = str(tr.amount)
                linked_transfer_direction = "out"  # 当該口座から出ていく振替
                linked_transfer_other_account_id = tr.to_account_id
                linked_transfer_other_account_name = tr.to_account.name
                linked_transfer_date = tr.date.isoformat()
                linked_transfer_notes = tr.notes or ""
                linked_transfer_opposite_free = tr.to_transaction_id is None
            else:
                tr = transfer_by_to_tx.get(tx.id)
                if tr is not None:
                    linked_transfer_id = tr.id
                    linked_transfer_amount = str(tr.amount)
                    linked_transfer_direction = "in"  # 当該口座へ入ってくる振替
                    linked_transfer_other_account_id = tr.from_account_id
                    linked_transfer_other_account_name = tr.from_account.name
                    linked_transfer_date = tr.date.isoformat()
                    linked_transfer_notes = tr.notes or ""
                    linked_transfer_opposite_free = tr.from_transaction_id is None

            payload.append(
                {
                    "id": tx.id,
                    "date": tx.date.isoformat(),
                    "description": tx.description or "",
                    "amount": str(tx.amount) if tx.amount is not None else None,
                    "balance": str(tx.balance) if tx.balance is not None else None,
                    "notes": tx.notes or "",
                    "linked_expense_amount": str(linked_total),
                    "linked_expense_count": tx.linked_expense_count or 0,
                    "linked_transfer_id": linked_transfer_id,
                    "linked_transfer_amount": linked_transfer_amount,
                    "linked_transfer_direction": linked_transfer_direction,
                    "linked_transfer_other_account_id": linked_transfer_other_account_id,
                    "linked_transfer_other_account_name": linked_transfer_other_account_name,
                    "linked_transfer_date": linked_transfer_date,
                    "linked_transfer_notes": linked_transfer_notes,
                    "linked_transfer_opposite_free": linked_transfer_opposite_free,
                }
            )

        return Response({"transactions": payload})


class CashAccountHistoryAPIView(APIView):
    """
    現金口座の入出履歴を Transfer / HouseholdExpense / CashAdjustment から統合して返す。
    """

    def get(self, request, account_id):
        try:
            account = PaymentAccount.objects.get(id=account_id)
        except PaymentAccount.DoesNotExist:
            return Response({"error": "口座が見つかりません。"}, status=status.HTTP_404_NOT_FOUND)
        if account.type != PaymentAccountType.CASH:
            return Response(
                {"error": "現金口座を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        month_value = request.query_params.get("month")
        month_range = get_month_range(month_value)
        if month_range is None:
            return Response(
                {"error": "month は YYYY-MM 形式で指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start, end_exclusive = month_range

        from household.models import HouseholdExpense

        entries: list[dict] = []

        transfers_in = Transfer.objects.filter(
            to_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).select_related("from_account")
        for tr in transfers_in:
            entries.append(
                {
                    "kind": "transfer_in",
                    "id": tr.id,
                    "date": tr.date.isoformat(),
                    "amount_signed": str(tr.amount),
                    "label": f"{tr.from_account.name} から入金",
                    "other_account_id": tr.from_account_id,
                    "other_account_name": tr.from_account.name,
                    "notes": tr.notes or "",
                }
            )

        transfers_out = Transfer.objects.filter(
            from_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).select_related("to_account")
        for tr in transfers_out:
            entries.append(
                {
                    "kind": "transfer_out",
                    "id": tr.id,
                    "date": tr.date.isoformat(),
                    "amount_signed": str(-tr.amount),
                    "label": f"{tr.to_account.name} へ出金",
                    "other_account_id": tr.to_account_id,
                    "other_account_name": tr.to_account.name,
                    "notes": tr.notes or "",
                }
            )

        # CashAdjustment 紐付けの Expense は adjustment 側のラインに統合するため
        # 単独表示からは除外する。
        expenses = HouseholdExpense.objects.filter(
            payment_account_id=account_id,
            date__gte=start,
            date__lt=end_exclusive,
            source_cash_adjustment__isnull=True,
        ).select_related("category")
        for ex in expenses:
            entries.append(
                {
                    "kind": "expense",
                    "id": ex.id,
                    "date": ex.date.isoformat(),
                    "amount_signed": str(-ex.amount),
                    "label": ex.category.name if ex.category_id else "支出",
                    "category_name": ex.category.name if ex.category_id else "",
                    "notes": ex.notes or "",
                }
            )

        adjustments = CashAdjustment.objects.filter(
            payment_account_id=account_id, date__gte=start, date__lt=end_exclusive
        ).annotate(
            linked_expense_total=Sum("expenses__amount"),
            linked_expense_count=Count("expenses"),
        )
        for adj in adjustments:
            signed = adj.amount if adj.direction == CashAdjustmentDirection.IN else -adj.amount
            linked_total = adj.linked_expense_total or DECIMAL_ZERO
            entries.append(
                {
                    "kind": "adjustment",
                    "id": adj.id,
                    "date": adj.date.isoformat(),
                    "amount_signed": str(signed),
                    "label": "入金" if adj.direction == CashAdjustmentDirection.IN else "出金",
                    "direction": adj.direction,
                    "notes": adj.notes or "",
                    "linked_expense_amount": str(linked_total),
                    "linked_expense_count": adj.linked_expense_count or 0,
                }
            )

        entries.sort(key=lambda e: (e["date"], e["id"]), reverse=True)
        return Response({"entries": entries})


class BankAccountCsvTemplateAPIView(APIView):
    def get(self, request, account_id):
        try:
            account = PaymentAccount.objects.select_related("default_csv_template").get(
                id=account_id
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if account.type == PaymentAccountType.CASH:
            return Response(
                {"error": "現金にはCSVテンプレートを設定できません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        template = account.default_csv_template
        if template is None:
            return Response(
                {"error": "CSVフォーマットが登録されていません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "name": template.name,
                "notes": template.notes,
                "has_header": template.has_header,
                "header_row_index": template.header_row_index,
                "date_formats": template.date_formats,
                "encoding": template.encoding,
                "amount_rule": template.amount_rule,
                "signed_amount_column": template.signed_amount_column,
                "deposit_column": template.deposit_column,
                "withdrawal_column": template.withdrawal_column,
                "date_column": template.date_column,
                "description_column": template.description_column,
                "balance_column": template.balance_column,
            }
        )

    def post(self, request, account_id):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response(
                {"error": "テンプレート名を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        notes = (request.data.get("notes") or "").strip()

        raw_amount_rule = request.data.get("amount_rule")
        if raw_amount_rule is None:
            return Response(
                {"error": "入出金判定の設定をしてください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            amount_rule = CsvAmountRule(raw_amount_rule)
        except ValueError:
            return Response(
                {"error": "入出金判定の設定が不正です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_column = (request.data.get("date_column") or "").strip()
        if not date_column:
            return Response(
                {"error": "取引日のカラムを設定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        has_header = parse_bool_value(request.data.get("has_header", True), default=True)
        header_row_index = request.data.get("header_row_index", 0)
        try:
            header_row_index_value = max(0, int(header_row_index))
        except (TypeError, ValueError):
            return Response(
                {"error": "ヘッダー行/データ開始行は数値で入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_formats = request.data.get("date_formats") or []
        if isinstance(date_formats, str):
            date_formats = [fmt.strip() for fmt in date_formats.split(",") if fmt.strip()]
        if not isinstance(date_formats, list):
            return Response(
                {"error": "日付フォーマットの指定が不正です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        register_records = parse_bool_value(
            request.data.get(
                "register_records",
                request.data.get("registerRecords", True),
            ),
            default=True,
        )
        encoding = request.data.get("encoding") or "cp932"
        if encoding not in {"cp932", "utf-8"}:
            return Response(
                {"error": "文字コードは cp932 または UTF-8 を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file = request.FILES.get("file")
        decoded_csv: str | None = None
        if register_records:
            if not file:
                return Response(
                    {"error": "CSVを登録する場合はCSVファイルを選択してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if file.size > MAX_CSV_UPLOAD_BYTES:
                return Response({"error": CSV_TOO_LARGE_ERROR}, status=status.HTTP_400_BAD_REQUEST)
            try:
                decoded_csv = file.read().decode(encoding)
            except UnicodeDecodeError:
                return Response(
                    {"error": "CSVの文字コードが一致しません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # UTF-8 BOM が残っていると 1 列目の列名が一致しなくなるので除去
            decoded_csv = decoded_csv.lstrip("﻿")

        with transaction.atomic():
            try:
                account = PaymentAccount.objects.get(id=account_id)
            except PaymentAccount.DoesNotExist:
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if account.type == PaymentAccountType.CASH:
                return Response(
                    {"error": "現金にはCSVテンプレートを設定できません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            template = CsvTemplate.objects.create(
                name=name,
                notes=notes,
                has_header=has_header,
                header_row_index=header_row_index_value,
                date_formats=date_formats,
                encoding=encoding,
                amount_rule=amount_rule,
                signed_amount_column=(request.data.get("signed_amount_column") or "").strip(),
                deposit_column=(request.data.get("deposit_column") or "").strip(),
                withdrawal_column=(request.data.get("withdrawal_column") or "").strip(),
                date_column=date_column,
                description_column=(request.data.get("description_column") or "").strip(),
                balance_column=(request.data.get("balance_column") or "").strip(),
            )

            account.default_csv_template = template
            account.save(update_fields=["default_csv_template"])

            created_count = 0
            if register_records:
                created_count, import_error = import_transactions_with_template(
                    account=account,
                    template=template,
                    decoded_csv=decoded_csv or "",
                )
                if import_error:
                    transaction.set_rollback(True)
                    return Response(
                        {"error": import_error},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        return Response(
            {
                "template_id": template.id,
                "account_id": account.id,
                "records_registered": register_records,
                "created": created_count,
            },
            status=status.HTTP_201_CREATED,
        )


class AccountCsvImportAPIView(APIView):
    def post(self, request):
        file = request.FILES.get("file")
        account_id = request.data.get("account_id")

        if not file:
            return Response(
                {"error": "CSVファイルを選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "取込先口座を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            account = PaymentAccount.objects.select_related("default_csv_template").get(
                id=account_id
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "取込先口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if account.type == PaymentAccountType.CASH:
            return Response(
                {"error": "現金にはCSVから取り込めません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        template = account.default_csv_template
        if template is None:
            return Response(
                {"error": "CSVフォーマットが登録されていません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 文字コードはテンプレート保存値を優先（リクエストでの上書きを許容）
        encoding = request.data.get("encoding") or template.encoding or "cp932"
        if encoding not in {"cp932", "utf-8"}:
            return Response(
                {"error": "文字コードは cp932 または UTF-8 を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if file.size > MAX_CSV_UPLOAD_BYTES:
            return Response({"error": CSV_TOO_LARGE_ERROR}, status=status.HTTP_400_BAD_REQUEST)
        try:
            decoded = file.read().decode(encoding)
        except UnicodeDecodeError:
            return Response(
                {"error": "CSVの文字コードが一致しません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        decoded = decoded.lstrip("﻿")

        created_count, import_error = import_transactions_with_template(
            account=account,
            template=template,
            decoded_csv=decoded,
        )
        if import_error:
            return Response(
                {"error": import_error},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "created": created_count,
            },
            status=status.HTTP_201_CREATED,
        )


class SnapshotCreateAPIView(APIView):
    def get(self, request):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )
        account_id = request.query_params.get("account_id") or request.query_params.get("accountId")

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "資産を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            if not FinancialAsset.objects.filter(id=account_id).exists():
                return Response(
                    {"error": "金融資産が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshots = FinancialAssetSnapshot.objects.filter(
                financial_asset_id=account_id
            ).order_by("-as_of", "-id")
        else:
            if not PaymentAccount.objects.filter(
                id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
            ).exists():
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshots = AccountBalanceSnapshot.objects.filter(account_id=account_id).order_by(
                "-as_of", "-id"
            )

        return Response(
            {"snapshots": [snapshot_payload(snapshot, asset_kind) for snapshot in snapshots]}
        )

    def post(self, request):
        asset_kind = normalize_asset_kind(
            request.data.get("asset_kind") or request.data.get("assetKind")
        )
        account_id = request.data.get("account_id")
        as_of = request.data.get("as_of")
        balance = request.data.get("balance")
        notes = request.data.get("notes") or ""

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "資産を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not as_of:
            return Response(
                {"error": "日付を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if balance is None:
            return Response(
                {"error": "残高を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            balance_value = parse_amount(str(balance))
        except InvalidAmountError:
            return Response(
                {"error": "残高の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            as_of_date = date.fromisoformat(as_of)
        except ValueError:
            return Response(
                {"error": "日付の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                if asset_kind == FINANCIAL_ASSET_KIND:
                    if not FinancialAsset.objects.filter(id=account_id).exists():
                        return Response(
                            {"error": "金融資産が見つかりません。"},
                            status=status.HTTP_404_NOT_FOUND,
                        )
                    FinancialAssetSnapshot.objects.create(
                        financial_asset_id=account_id,
                        as_of=as_of_date,
                        amount=balance_value,
                        notes=notes.strip(),
                    )
                else:
                    if not PaymentAccount.objects.filter(
                        id=account_id, type=KIND_TO_PAYMENT_TYPE[asset_kind]
                    ).exists():
                        return Response(
                            {"error": "取引先口座がみつかりません。"},
                            status=status.HTTP_404_NOT_FOUND,
                        )
                    AccountBalanceSnapshot.objects.create(
                        account_id=account_id,
                        as_of=as_of_date,
                        balance=balance_value,
                        notes=notes.strip(),
                    )
        except IntegrityError:
            return Response(
                {"error": "同じ日付のスナップショットが既に登録されています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"created": 1},
            status=status.HTTP_201_CREATED,
        )


class SnapshotDetailAPIView(APIView):
    def patch(self, request, snapshot_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind")
            or request.query_params.get("assetKind")
            or request.data.get("asset_kind")
            or request.data.get("assetKind")
        )
        as_of = request.data.get("as_of")
        balance = request.data.get("balance")
        notes = request.data.get("notes") or ""

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not as_of:
            return Response(
                {"error": "日付を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if balance is None:
            return Response(
                {"error": "残高を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            balance_value = parse_amount(str(balance))
        except InvalidAmountError:
            return Response(
                {"error": "残高の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            as_of_date = date.fromisoformat(as_of)
        except ValueError:
            return Response(
                {"error": "日付の形式が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            try:
                snapshot = FinancialAssetSnapshot.objects.get(id=snapshot_id)
            except FinancialAssetSnapshot.DoesNotExist:
                return Response(
                    {"error": "スナップショットが見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshot.as_of = as_of_date
            snapshot.amount = balance_value
            snapshot.notes = notes.strip()
        else:
            try:
                snapshot = AccountBalanceSnapshot.objects.get(id=snapshot_id)
            except AccountBalanceSnapshot.DoesNotExist:
                return Response(
                    {"error": "スナップショットが見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            snapshot.as_of = as_of_date
            snapshot.balance = balance_value
            snapshot.notes = notes.strip()

        try:
            snapshot.save()
        except IntegrityError:
            return Response(
                {"error": "同じ日付のスナップショットが既に登録されています。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "updated": 1,
                "snapshot": snapshot_payload(snapshot, asset_kind),
            }
        )

    def delete(self, request, snapshot_id):
        asset_kind = normalize_asset_kind(
            request.query_params.get("asset_kind") or request.query_params.get("assetKind")
        )

        if asset_kind is None:
            return Response(
                {"error": "資産種別が正しくありません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if asset_kind == FINANCIAL_ASSET_KIND:
            deleted, _ = FinancialAssetSnapshot.objects.filter(id=snapshot_id).delete()
        else:
            deleted, _ = AccountBalanceSnapshot.objects.filter(id=snapshot_id).delete()

        if deleted == 0:
            return Response(
                {"error": "スナップショットが見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"deleted": 1})

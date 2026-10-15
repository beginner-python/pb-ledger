"""ledger API の OpenAPI 用 serializer とクエリパラメータ定義。

ビューは素の APIView で dict を返すため、ここで応答の形を宣言して @extend_schema から参照する。
金額は小数 2 桁の文字列 (例 "1234.00")、日付は ISO 形式の文字列。
"""

from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

from api.schema import CreatedOut, DeletedOut, DetailOut, ErrorOut  # noqa: F401 (再エクスポート)

ASSET_KINDS = ["bank_account", "credit_card", "cash", "financial_asset"]

MONTH_PARAM = OpenApiParameter(
    "month", str, OpenApiParameter.QUERY, description="対象月 (YYYY-MM)。省略時は当月。"
)
LIMIT_PARAM = OpenApiParameter(
    "limit", int, OpenApiParameter.QUERY, description="最大件数 (1〜200、既定 50)。"
)
ASSET_KIND_PARAM = OpenApiParameter(
    "assetKind",
    str,
    OpenApiParameter.QUERY,
    description="資産種別。",
    enum=ASSET_KINDS,
    required=True,
)
ACCOUNT_ID_PARAM = OpenApiParameter(
    "accountId",
    int,
    OpenApiParameter.QUERY,
    description="口座 (金融資産なら資産) の ID。",
    required=True,
)
PAYMENT_ACCOUNT_ID_PARAM = OpenApiParameter(
    "paymentAccountId", int, OpenApiParameter.QUERY, description="現金口座の ID で絞り込む。"
)


class Money(serializers.DecimalField):
    def __init__(self, **kwargs):
        kwargs.setdefault("max_digits", 14)
        kwargs.setdefault("decimal_places", 2)
        kwargs.setdefault("coerce_to_string", True)
        super().__init__(**kwargs)


# ---------------------------------------------------------------- 決済手段
class PaymentAccountOut(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    type = serializers.ChoiceField(choices=["bank", "credit_card", "cash"])
    kind = serializers.ChoiceField(choices=ASSET_KINDS[:3])


class PaymentAccountsOut(serializers.Serializer):
    accounts = PaymentAccountOut(many=True)


class AccountCreateIn(serializers.Serializer):
    asset_kind = serializers.ChoiceField(choices=ASSET_KINDS)
    name = serializers.CharField(max_length=100)
    branch_name = serializers.CharField(required=False, help_text="銀行口座のみ")
    account_number = serializers.CharField(required=False, help_text="銀行口座のみ")
    issuer = serializers.CharField(required=False, help_text="カードのみ")
    last4 = serializers.CharField(required=False, max_length=4, help_text="カードのみ")
    closing_day = serializers.IntegerField(required=False, min_value=1, max_value=31)
    payment_day = serializers.IntegerField(required=False, min_value=1, max_value=31)


class AccountPatchIn(serializers.Serializer):
    reference_url = serializers.URLField(allow_blank=True, help_text="明細ページなどの参照 URL")


class AccountPatchOut(serializers.Serializer):
    account_id = serializers.IntegerField()
    reference_url = serializers.CharField(allow_blank=True)


class AccountDeleteOut(serializers.Serializer):
    deleted = serializers.IntegerField()
    deleted_transactions = serializers.IntegerField()
    deleted_snapshots = serializers.IntegerField()


# ---------------------------------------------------------------- 資産管理
class AssetAccountOut(serializers.Serializer):
    asset_kind = serializers.ChoiceField(choices=ASSET_KINDS)
    account_id = serializers.IntegerField()
    account_name = serializers.CharField()
    balance = Money(allow_null=True, help_text="カードは当月利用額")
    previous_balance = Money(allow_null=True)
    balance_change = Money(allow_null=True)
    last_updated = serializers.DateField(allow_null=True)
    source = serializers.ChoiceField(
        choices=["transaction", "snapshot", "computed", "none"],
        help_text="残高の根拠。明細の残高列 / スナップショット / 動的計算 / 無し",
    )
    has_csv_template = serializers.BooleanField()
    csv_template_id = serializers.IntegerField(allow_null=True)
    reference_url = serializers.CharField(allow_blank=True)


class AssetsOut(serializers.Serializer):
    total_assets = Money(help_text="銀行 + 現金 + 金融資産 (カードは含めない)")
    total_assets_change = Money()
    bank_accounts_total = Money()
    bank_accounts_total_change = Money()
    credit_cards_total = Money()
    credit_cards_total_change = Money()
    cash_wallets_total = Money()
    cash_wallets_total_change = Money()
    financial_assets_total = Money()
    financial_assets_total_change = Money()
    previous_month_end = serializers.DateField()
    bank_accounts = AssetAccountOut(many=True)
    credit_cards = AssetAccountOut(many=True)
    cash_wallets = AssetAccountOut(many=True)
    financial_assets = AssetAccountOut(many=True)


class MonthlySummaryAccountOut(serializers.Serializer):
    account_id = serializers.IntegerField()
    income = Money()
    expense = Money()


class MonthlySummaryOut(serializers.Serializer):
    total_income = Money()
    total_expense = Money()
    accounts = MonthlySummaryAccountOut(many=True)


# ---------------------------------------------------------------- 明細
class TransactionOut(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    description = serializers.CharField(allow_blank=True)
    amount = Money(allow_null=True, help_text="出金は負")
    balance = Money(allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    linked_expense_amount = Money(allow_null=True, help_text="この明細に紐付いた支出の合計")
    linked_expense_count = serializers.IntegerField()
    linked_transfer_id = serializers.IntegerField(allow_null=True)
    linked_transfer_amount = Money(allow_null=True)
    linked_transfer_direction = serializers.ChoiceField(choices=["in", "out"], allow_null=True)
    linked_transfer_other_account_id = serializers.IntegerField(allow_null=True)
    linked_transfer_other_account_name = serializers.CharField(allow_null=True)
    linked_transfer_date = serializers.DateField(allow_null=True)
    linked_transfer_notes = serializers.CharField(allow_null=True)
    linked_transfer_opposite_free = serializers.BooleanField()


class TransactionsOut(serializers.Serializer):
    transactions = TransactionOut(many=True)


# ---------------------------------------------------------------- 現金
class CashAdjustmentOut(serializers.Serializer):
    id = serializers.IntegerField()
    payment_account_id = serializers.IntegerField()
    date = serializers.DateField()
    direction = serializers.ChoiceField(choices=["in", "out"])
    amount = Money()
    category = serializers.ChoiceField(choices=["allowance", "gift", "repayment", "other"])
    counterparty_name = serializers.CharField(allow_blank=True)
    notes = serializers.CharField(allow_blank=True)


class CashAdjustmentsOut(serializers.Serializer):
    adjustments = CashAdjustmentOut(many=True)


class CashAdjustmentIn(serializers.Serializer):
    payment_account_id = serializers.IntegerField()
    date = serializers.DateField()
    direction = serializers.ChoiceField(choices=["in", "out"])
    amount = Money()
    category = serializers.ChoiceField(
        choices=["allowance", "gift", "repayment", "other"], required=False
    )
    counterparty_name = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CashAdjustmentPatchIn(serializers.Serializer):
    date = serializers.DateField(required=False)
    direction = serializers.ChoiceField(choices=["in", "out"], required=False)
    amount = Money(required=False)
    category = serializers.ChoiceField(
        choices=["allowance", "gift", "repayment", "other"], required=False
    )
    counterparty_name = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CashHistoryEntryOut(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["transfer_in", "transfer_out", "expense", "adjustment"])
    id = serializers.IntegerField()
    date = serializers.DateField()
    amount_signed = Money(help_text="残高への影響。入金は正、出金は負")
    label = serializers.CharField()
    notes = serializers.CharField(allow_blank=True)
    other_account_id = serializers.IntegerField(required=False)
    other_account_name = serializers.CharField(required=False)
    category_name = serializers.CharField(required=False)
    category = serializers.CharField(required=False)
    direction = serializers.ChoiceField(choices=["in", "out"], required=False)
    counterparty_name = serializers.CharField(required=False)
    linked_expense_amount = Money(required=False)
    linked_expense_count = serializers.IntegerField(required=False)


class CashHistoryOut(serializers.Serializer):
    entries = CashHistoryEntryOut(many=True)


# ---------------------------------------------------------------- CSV
class CsvTemplateOut(serializers.Serializer):
    name = serializers.CharField()
    notes = serializers.CharField(allow_blank=True)
    has_header = serializers.BooleanField()
    header_row_index = serializers.IntegerField()
    date_formats = serializers.ListField(child=serializers.CharField())
    encoding = serializers.ChoiceField(choices=["cp932", "utf-8"])
    amount_rule = serializers.ChoiceField(choices=["signed", "split", "usage"])
    signed_amount_column = serializers.CharField(allow_blank=True)
    deposit_column = serializers.CharField(allow_blank=True)
    withdrawal_column = serializers.CharField(allow_blank=True)
    date_column = serializers.CharField(allow_blank=True)
    description_column = serializers.CharField(allow_blank=True)
    balance_column = serializers.CharField(allow_blank=True)


class CsvTemplateIn(serializers.Serializer):
    name = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True)
    has_header = serializers.BooleanField(required=False)
    header_row_index = serializers.IntegerField(required=False)
    date_formats = serializers.CharField(
        required=False, help_text="strptime 形式をカンマ区切りで (例 %Y/%m/%d,%Y-%m-%d)"
    )
    encoding = serializers.ChoiceField(choices=["cp932", "utf-8"], required=False)
    amount_rule = serializers.ChoiceField(choices=["signed", "split", "usage"], required=False)
    signed_amount_column = serializers.CharField(required=False, allow_blank=True)
    deposit_column = serializers.CharField(required=False, allow_blank=True)
    withdrawal_column = serializers.CharField(required=False, allow_blank=True)
    date_column = serializers.CharField()
    description_column = serializers.CharField(required=False, allow_blank=True)
    balance_column = serializers.CharField(required=False, allow_blank=True)
    register_records = serializers.BooleanField(
        required=False, help_text="true なら file の明細も同時に取り込む"
    )
    file = serializers.FileField(required=False, help_text="CSV (1 MB・5,000 行まで)")


class CsvTemplateCreatedOut(serializers.Serializer):
    template_id = serializers.IntegerField()
    account_id = serializers.IntegerField()
    records_registered = serializers.BooleanField()
    created = serializers.IntegerField(help_text="同時に取り込んだ明細の件数")


class CsvImportIn(serializers.Serializer):
    account_id = serializers.IntegerField()
    encoding = serializers.ChoiceField(
        choices=["cp932", "utf-8"], required=False, help_text="省略時はテンプレートの値"
    )
    file = serializers.FileField(help_text="CSV (1 MB・5,000 行まで)")


# ---------------------------------------------------------------- スナップショット
class SnapshotOut(serializers.Serializer):
    id = serializers.IntegerField()
    asset_kind = serializers.ChoiceField(choices=ASSET_KINDS)
    account_id = serializers.IntegerField()
    as_of = serializers.DateField()
    balance = Money()
    notes = serializers.CharField(allow_blank=True)


class SnapshotsOut(serializers.Serializer):
    snapshots = SnapshotOut(many=True)


class SnapshotIn(serializers.Serializer):
    asset_kind = serializers.ChoiceField(choices=ASSET_KINDS)
    account_id = serializers.IntegerField()
    as_of = serializers.DateField()
    balance = Money()
    notes = serializers.CharField(required=False, allow_blank=True)


class SnapshotPatchIn(serializers.Serializer):
    as_of = serializers.DateField(required=False)
    balance = Money(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class SnapshotUpdatedOut(serializers.Serializer):
    updated = serializers.IntegerField()
    snapshot = SnapshotOut()


# ---------------------------------------------------------------- 振替
class TransferOut(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    amount = Money()
    from_account_id = serializers.IntegerField()
    to_account_id = serializers.IntegerField()
    from_transaction_id = serializers.IntegerField(allow_null=True)
    to_transaction_id = serializers.IntegerField(allow_null=True)
    notes = serializers.CharField(allow_blank=True)


class TransfersOut(serializers.Serializer):
    transfers = TransferOut(many=True)


class TransferIn(serializers.Serializer):
    date = serializers.DateField()
    amount = Money()
    from_account_id = serializers.IntegerField()
    to_account_id = serializers.IntegerField()
    from_transaction_id = serializers.IntegerField(required=False, allow_null=True)
    to_transaction_id = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class TransferPatchIn(serializers.Serializer):
    from_account_id = serializers.IntegerField(required=False)
    to_account_id = serializers.IntegerField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)

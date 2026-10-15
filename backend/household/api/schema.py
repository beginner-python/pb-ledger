"""household API の OpenAPI 用 serializer とクエリパラメータ定義。

ビューは素の APIView で dict を返すため、ここで応答の形を宣言して @extend_schema から参照する。
金額は小数 2 桁の文字列 (例 "1234.00")、日付は ISO 形式の文字列。
"""

from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

from api.schema import DeletedOut, DetailOut, ErrorOut  # noqa: F401 (再エクスポート)
from ledger.api.schema import Money

YEAR_PARAM = OpenApiParameter("year", int, OpenApiParameter.QUERY, description="対象年 (西暦)。")
MONTH_PARAM = OpenApiParameter("month", int, OpenApiParameter.QUERY, description="対象月 (1〜12)。")
PAYMENT_ACCOUNT_ID_PARAM = OpenApiParameter(
    "paymentAccountId", int, OpenApiParameter.QUERY, description="支払元の決済手段 ID で絞り込む。"
)
UNLINKED_ONLY_PARAM = OpenApiParameter(
    "unlinkedOnly",
    bool,
    OpenApiParameter.QUERY,
    description="true なら明細にも現金入出金にも紐付いていない支出だけを返す。",
)
SOURCE_TRANSACTION_ID_PARAM = OpenApiParameter(
    "sourceTransactionId",
    int,
    OpenApiParameter.QUERY,
    description="この明細に紐付いた支出だけを返す。",
)
SOURCE_CASH_ADJUSTMENT_ID_PARAM = OpenApiParameter(
    "sourceCashAdjustmentId",
    int,
    OpenApiParameter.QUERY,
    description="この現金入出金に紐付いた支出だけを返す。",
)

YEARS_SCHEMA = {"type": "array", "items": {"type": "integer"}, "example": [2025, 2026]}


# ---------------------------------------------------------------- カテゴリ
class CategoryOut(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    color = serializers.CharField(allow_blank=True, help_text="HEX (例 #1f927f)。空なら自動")
    notes = serializers.CharField(allow_blank=True)
    parent_id = serializers.IntegerField(allow_null=True)
    has_children = serializers.BooleanField()


class CategoryIn(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    color = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    parent_id = serializers.IntegerField(
        required=False, allow_null=True, help_text="親カテゴリ。階層は 2 段まで"
    )


# ---------------------------------------------------------------- 支出
class SourceTransactionOut(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    description = serializers.CharField(allow_blank=True)
    amount = Money(allow_null=True)


class ExpenseOut(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    amount = Money()
    notes = serializers.CharField(allow_blank=True)
    category_id = serializers.IntegerField()
    category_name = serializers.CharField()
    category_color = serializers.CharField(allow_blank=True)
    payment_account_id = serializers.IntegerField(allow_null=True)
    payment_account_name = serializers.CharField(allow_null=True)
    payment_account_type = serializers.CharField(allow_null=True)
    source_transaction_id = serializers.IntegerField(allow_null=True)
    source_transaction = SourceTransactionOut(allow_null=True)
    source_cash_adjustment_id = serializers.IntegerField(allow_null=True)


class ExpenseIn(serializers.Serializer):
    date = serializers.DateField()
    amount = Money()
    category_id = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True)
    payment_account_id = serializers.IntegerField(required=False, allow_null=True)
    source_transaction_id = serializers.IntegerField(
        required=False, allow_null=True, help_text="紐付ける明細。残額を超える金額は登録できない"
    )


class ExpensePatchIn(serializers.Serializer):
    date = serializers.DateField(required=False)
    amount = Money(required=False)
    category_id = serializers.IntegerField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    payment_account_id = serializers.IntegerField(required=False, allow_null=True)
    source_transaction_id = serializers.IntegerField(required=False, allow_null=True)
    source_cash_adjustment_id = serializers.IntegerField(required=False, allow_null=True)


class ExpenseCreatedOut(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    amount = Money()
    notes = serializers.CharField(allow_blank=True)
    category_id = serializers.IntegerField()
    payment_account_id = serializers.IntegerField(allow_null=True)
    source_transaction_id = serializers.IntegerField(allow_null=True)
    source_cash_adjustment_id = serializers.IntegerField(allow_null=True)


class ExpenseUpdatedOut(ExpenseCreatedOut):
    category_name = serializers.CharField()
    category_color = serializers.CharField(allow_blank=True)


# ---------------------------------------------------------------- 集計
class ExpenseSummaryItemOut(serializers.Serializer):
    category_id = serializers.IntegerField()
    category_name = serializers.CharField()
    category_color = serializers.CharField(allow_blank=True)
    parent_category_id = serializers.IntegerField(allow_null=True)
    total = Money()


class ExpenseSummaryOut(serializers.Serializer):
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    total = Money()
    items = ExpenseSummaryItemOut(many=True)


class BudgetSummaryItemOut(serializers.Serializer):
    allocation_id = serializers.IntegerField()
    category_id = serializers.IntegerField()
    category_name = serializers.CharField()
    category_color = serializers.CharField(allow_blank=True)
    parent_category_id = serializers.IntegerField(allow_null=True)
    is_parent = serializers.BooleanField()
    budget = Money()
    spent = Money(help_text="自分と子カテゴリの支出合計")
    own_spent = Money()
    children_spent = Money()
    children_with_budget_spent = Money(help_text="個別予算を持つ子の支出")
    children_without_budget_spent = Money(help_text="親予算で管理する子の支出")
    remaining = Money()
    usage_rate = serializers.DecimalField(max_digits=10, decimal_places=4, coerce_to_string=True)
    notes = serializers.CharField(allow_blank=True)


class BudgetSummaryOut(serializers.Serializer):
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    period_id = serializers.IntegerField(allow_null=True)
    period_total_amount = Money(allow_null=True, help_text="月の上限。未設定なら null")
    period_total_spent = Money(help_text="予算未設定カテゴリも含む月の支出合計")
    total_budget = Money(help_text="カテゴリ予算の合計 (親子の二重計上なし)")
    total_spent = Money()
    items = BudgetSummaryItemOut(many=True)


# ---------------------------------------------------------------- 予算
class BudgetIn(serializers.Serializer):
    year = serializers.IntegerField()
    month = serializers.IntegerField(min_value=1, max_value=12)
    category_id = serializers.IntegerField()
    amount = Money()
    notes = serializers.CharField(required=False, allow_blank=True)


class BudgetPatchIn(serializers.Serializer):
    category_id = serializers.IntegerField(required=False)
    amount = Money(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class BudgetOut(serializers.Serializer):
    id = serializers.IntegerField()
    period_id = serializers.IntegerField()
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    category_id = serializers.IntegerField()
    amount = Money()
    notes = serializers.CharField(allow_blank=True)


class PeriodTotalIn(serializers.Serializer):
    year = serializers.IntegerField()
    month = serializers.IntegerField(min_value=1, max_value=12)
    total_amount = Money(allow_null=True, help_text="null で上限を解除")


class PeriodTotalOut(serializers.Serializer):
    period_id = serializers.IntegerField()
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    total_amount = Money(allow_null=True)


class BudgetCopyIn(serializers.Serializer):
    source_year = serializers.IntegerField()
    source_month = serializers.IntegerField(min_value=1, max_value=12)
    target_year = serializers.IntegerField()
    target_month = serializers.IntegerField(min_value=1, max_value=12)


class BudgetCopyOut(serializers.Serializer):
    copied = serializers.IntegerField()
    skipped = serializers.IntegerField(help_text="コピー先に既にあったカテゴリの数")
    target_period_id = serializers.IntegerField()
    total_amount_copied = serializers.BooleanField(help_text="月の上限もコピーしたか")

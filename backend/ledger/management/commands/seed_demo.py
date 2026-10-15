"""
デモ用の架空データを投入する。

- すべて架空の口座・店名・金額。実在の金融機関名や個人情報は含めない。
- 乱数は固定シードなので、同じ基準日なら毎回同じデータになる。
- 既存データを全削除してから投入するため、開発設定 (DEBUG=True) でも
  DB 名に "demo" を含む場合でもなければ、--force を付けない限り実行を拒否する。
"""

import random
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from household.models import (
    BudgetAllocation,
    BudgetPeriod,
    HouseholdCategory,
    HouseholdExpense,
)
from ledger.models import (
    AccountBalanceSnapshot,
    CashAdjustment,
    CashAdjustmentCategory,
    CashAdjustmentDirection,
    CsvAmountRule,
    CsvEncoding,
    CsvTemplate,
    FinancialAsset,
    FinancialAssetSnapshot,
    NormalizedTransaction,
    PaymentAccount,
    PaymentAccountType,
    Transfer,
)

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password"
MONTHS = 8  # 基準月を含めて何か月分を生成するか

# (親カテゴリ, 色, [子カテゴリ...])
CATEGORY_TREE = [
    ("食費", "#e07a5f", ["食料品", "外食"]),
    ("日用品", "#81b29a", []),
    ("住居", "#3d405b", ["家賃"]),
    ("水道光熱", "#f2cc8f", ["電気", "ガス", "水道"]),
    ("通信", "#6d597a", []),
    ("交通", "#355070", ["ガソリン", "電車"]),
    ("娯楽", "#b56576", ["サブスク", "書籍"]),
    ("衣服・美容", "#eaac8b", []),
    ("医療", "#90be6d", []),
]

# カード利用の候補: (摘要, 子カテゴリ名, 金額レンジ)
CARD_MERCHANTS = [
    ("スーパー ○○", "食料品", (1800, 6500)),
    ("ドラッグストア △△", "日用品", (900, 3200)),
    ("コンビニ □□", "食料品", (300, 1200)),
    ("書店 ◇◇", "書籍", (900, 2800)),
    ("ガソリンスタンド", "ガソリン", (4000, 7000)),
    ("レストラン ☆☆", "外食", (1500, 5200)),
    ("動画配信サービス", "サブスク", (990, 990)),
    ("衣料品店", "衣服・美容", (2500, 9800)),
    ("通販サイト", "日用品", (1200, 8900)),
    ("カフェ", "外食", (450, 1300)),
]

# 現金払いの候補
CASH_ITEMS = [
    ("ランチ", "外食", (700, 1200)),
    ("自動販売機", "食料品", (130, 180)),
    ("電車", "電車", (220, 980)),
    ("理髪店", "衣服・美容", (3500, 4500)),
    ("薬局", "医療", (800, 2400)),
]

# 月次予算 (カテゴリ名 -> 金額)
BUDGET_TOTAL = Decimal("250000")
BUDGETS = {
    "食費": 60000,
    "食料品": 40000,
    "外食": 20000,
    "日用品": 10000,
    "住居": 85000,
    "家賃": 85000,
    "水道光熱": 20000,
    "通信": 5000,
    "交通": 15000,
    "娯楽": 10000,
    "衣服・美容": 10000,
    "医療": 5000,
}


def month_end(d: date) -> date:
    return date(d.year, d.month, monthrange(d.year, d.month)[1])


def shift_month(d: date, delta: int) -> date:
    index = d.year * 12 + (d.month - 1) + delta
    return date(index // 12, index % 12 + 1, 1)


def yen(value) -> Decimal:
    return Decimal(int(value))


class Command(BaseCommand):
    help = "Seed fictional demo data (wipes ledger/household tables first)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--anchor",
            help="基準日 (YYYY-MM-DD)。省略時は今日。",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="DB 名に 'demo' を含まなくても実行する。",
        )

    def handle(self, *args, **options):
        # 全削除を伴うので、開発設定 (DEBUG) か demo 用 DB 以外では明示的な --force を要求する
        db_name = str(settings.DATABASES["default"]["NAME"])
        if not (settings.DEBUG or "demo" in db_name.lower() or options["force"]):
            raise CommandError(
                f"DB '{db_name}' は開発用でも demo 用でもありません。--force を付けてください。"
            )

        anchor = date.fromisoformat(options["anchor"]) if options["anchor"] else date.today()
        self.rng = random.Random(20260101)

        with transaction.atomic():
            self._wipe()
            user = self._ensure_user()
            self.user = user
            categories = self._create_categories()
            accounts = self._create_accounts()
            self._create_financial_assets(anchor)
            card_usage = self._create_card_activity(anchor, accounts, categories)
            self._create_bank_activity(anchor, accounts, categories, card_usage)
            self._create_cash_activity(anchor, accounts, categories)
            self._create_budgets(anchor, categories)

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data seeded (anchor={anchor.isoformat()}, user={DEMO_EMAIL})."
            )
        )

    # ------------------------------------------------------------------ setup

    def _wipe(self):
        HouseholdExpense.objects.all().delete()
        BudgetAllocation.objects.all().delete()
        BudgetPeriod.objects.all().delete()
        HouseholdCategory.objects.all().delete()
        Transfer.objects.all().delete()
        CashAdjustment.objects.all().delete()
        NormalizedTransaction.objects.all().delete()
        AccountBalanceSnapshot.objects.all().delete()
        FinancialAssetSnapshot.objects.all().delete()
        FinancialAsset.objects.all().delete()
        PaymentAccount.objects.all().delete()
        CsvTemplate.objects.all().delete()

    def _ensure_user(self):
        User = get_user_model()
        user, _ = User.objects.get_or_create(email=DEMO_EMAIL)
        user.set_password(DEMO_PASSWORD)
        user.is_staff = False
        user.is_superuser = False
        user.save()
        return user

    def _create_categories(self) -> dict[str, HouseholdCategory]:
        categories: dict[str, HouseholdCategory] = {}
        for parent_name, color, children in CATEGORY_TREE:
            parent = HouseholdCategory.objects.create(
                name=parent_name, color=color, created_by=self.user
            )
            categories[parent_name] = parent
            for child_name in children:
                categories[child_name] = HouseholdCategory.objects.create(
                    name=child_name, parent=parent, color=color, created_by=self.user
                )
        return categories

    def _create_accounts(self) -> dict[str, PaymentAccount]:
        bank_template = CsvTemplate.objects.create(
            name="銀行明細 (入金/出金 分離)",
            encoding=CsvEncoding.UTF8,
            amount_rule=CsvAmountRule.SPLIT,
            date_formats=["%Y/%m/%d"],
            date_column="日付",
            description_column="摘要",
            deposit_column="入金",
            withdrawal_column="出金",
            balance_column="残高",
            created_by=self.user,
        )
        card_template = CsvTemplate.objects.create(
            name="カード明細 (利用額)",
            encoding=CsvEncoding.UTF8,
            amount_rule=CsvAmountRule.USAGE,
            date_formats=["%Y/%m/%d"],
            date_column="利用日",
            description_column="利用店名",
            withdrawal_column="利用金額",
            created_by=self.user,
        )

        main_bank = PaymentAccount.objects.create(
            type=PaymentAccountType.BANK,
            name="メイン口座",
            display_order=1,
            branch_name="本店",
            account_number="0000001",
            default_csv_template=bank_template,
            created_by=self.user,
        )
        savings = PaymentAccount.objects.create(
            type=PaymentAccountType.BANK,
            name="貯蓄口座",
            display_order=2,
            branch_name="本店",
            account_number="0000002",
            default_csv_template=bank_template,
            created_by=self.user,
        )
        wallet = PaymentAccount.objects.create(
            type=PaymentAccountType.CASH,
            name="財布",
            display_order=3,
            created_by=self.user,
        )
        card = PaymentAccount.objects.create(
            type=PaymentAccountType.CREDIT_CARD,
            name="クレジットカードA",
            display_order=4,
            issuer="架空カード株式会社",
            last4="0000",
            closing_day=15,
            payment_day=27,
            default_csv_template=card_template,
            created_by=self.user,
        )
        return {"main": main_bank, "savings": savings, "wallet": wallet, "card": card}

    def _create_financial_assets(self, anchor: date):
        fund = FinancialAsset.objects.create(
            name="投資信託 (インデックス)", display_order=1, created_by=self.user
        )
        stock = FinancialAsset.objects.create(name="個別株", display_order=2, created_by=self.user)
        fund_value = 1_480_000
        stock_value = 410_000
        for offset in range(-MONTHS, 1):
            as_of = month_end(shift_month(anchor, offset))
            if as_of > anchor:
                as_of = anchor
            fund_value += 30_000 + self.rng.randint(-45_000, 60_000)
            stock_value += self.rng.randint(-35_000, 40_000)
            FinancialAssetSnapshot.objects.create(
                financial_asset=fund,
                as_of=as_of,
                amount=yen(fund_value),
                created_by=self.user,
            )
            FinancialAssetSnapshot.objects.create(
                financial_asset=stock,
                as_of=as_of,
                amount=yen(stock_value),
                created_by=self.user,
            )

    # --------------------------------------------------------------- activity

    def _months(self, anchor: date):
        """古い月から順に (year, month, month_start, month_end) を返す。"""
        for offset in range(-(MONTHS - 1), 1):
            start = shift_month(anchor, offset)
            yield start.year, start.month, start, month_end(start)

    def _create_card_activity(self, anchor, accounts, categories) -> dict[tuple, int]:
        """カード利用明細と、その多くに紐づく支出を作る。月ごとの利用額を返す。"""
        card = accounts["card"]
        usage: dict[tuple, int] = {}
        for year, month, _start, end in self._months(anchor):
            count = self.rng.randint(12, 18)
            total = 0
            days = sorted(self.rng.randint(1, end.day) for _ in range(count))
            for i, day in enumerate(days):
                tx_date = date(year, month, day)
                if tx_date > anchor:
                    break
                merchant, category_name, (low, high) = self.rng.choice(CARD_MERCHANTS)
                amount = self.rng.randint(low, high)
                total += amount
                tx = NormalizedTransaction.objects.create(
                    account=card,
                    date=tx_date,
                    amount=-yen(amount),
                    description=merchant,
                    created_by=self.user,
                )
                # 月に 2 件程度は未分類のまま残し、紐付け操作を試せるようにする
                if i % 7 != 3:
                    HouseholdExpense.objects.create(
                        date=tx_date,
                        amount=yen(amount),
                        category=categories[category_name],
                        payment_account=card,
                        source_transaction=tx,
                        notes=merchant,
                        created_by=self.user,
                    )
            usage[(year, month)] = total
        return usage

    def _create_bank_activity(self, anchor, accounts, categories, card_usage):
        main = accounts["main"]
        savings = accounts["savings"]
        wallet = accounts["wallet"]

        main_rows: list[tuple[date, str, int, dict]] = []
        savings_rows: list[tuple[date, str, int, dict]] = []

        first_start = shift_month(anchor, -(MONTHS - 1))
        # 期首残高はスナップショットで与える
        AccountBalanceSnapshot.objects.create(
            account=main,
            as_of=first_start - timedelta(days=1),
            balance=yen(842_310),
            notes="期首残高",
            created_by=self.user,
        )
        AccountBalanceSnapshot.objects.create(
            account=savings,
            as_of=first_start - timedelta(days=1),
            balance=yen(1_250_000),
            notes="期首残高",
            created_by=self.user,
        )
        main_balance = 842_310
        savings_balance = 1_250_000

        for year, month, start, _end in self._months(anchor):
            prev = shift_month(start, -1)
            rows = [
                (
                    date(year, month, 1),
                    "振替 貯蓄口座",
                    -50_000,
                    {"transfer": "savings"},
                ),
                (date(year, month, 3), "ATM 出金", -20_000, {"transfer": "cash"}),
                (date(year, month, 5), "携帯電話料金", -4_480, {"category": "通信"}),
                (
                    date(year, month, 10),
                    "電気料金",
                    -self.rng.randint(5_200, 9_800),
                    {"category": "電気"},
                ),
                (
                    date(year, month, 15),
                    "ガス料金",
                    -self.rng.randint(2_800, 6_400),
                    {"category": "ガス"},
                ),
                (date(year, month, 25), "給与振込", 318_500, {}),
                (date(year, month, 27), "家賃", -85_000, {"category": "家賃"}),
                (
                    date(year, month, 27),
                    "カード利用代金",
                    -card_usage.get((prev.year, prev.month), 0),
                    {"transfer": "card"},
                ),
            ]
            if month % 2 == 0:
                rows.append(
                    (
                        date(year, month, 20),
                        "水道料金",
                        -self.rng.randint(3_600, 5_200),
                        {"category": "水道"},
                    )
                )
            for row in sorted(rows, key=lambda r: r[0]):
                if row[0] > anchor or row[2] == 0:
                    continue
                main_rows.append(row)
                if row[3].get("transfer") == "savings":
                    savings_rows.append((row[0], "振替 メイン口座", 50_000, {}))

        for tx_date, description, amount, meta in main_rows:
            main_balance += amount
            tx = NormalizedTransaction.objects.create(
                account=main,
                date=tx_date,
                amount=yen(amount),
                balance=yen(main_balance),
                description=description,
                created_by=self.user,
            )
            if "category" in meta:
                HouseholdExpense.objects.create(
                    date=tx_date,
                    amount=yen(-amount),
                    category=categories[meta["category"]],
                    payment_account=main,
                    source_transaction=tx,
                    notes=description,
                    created_by=self.user,
                )
            elif meta.get("transfer") == "cash":
                Transfer.objects.create(
                    date=tx_date,
                    amount=yen(-amount),
                    from_account=main,
                    to_account=wallet,
                    from_transaction=tx,
                    notes="ATM 出金",
                    created_by=self.user,
                )
            elif meta.get("transfer") == "card":
                Transfer.objects.create(
                    date=tx_date,
                    amount=yen(-amount),
                    from_account=main,
                    to_account=accounts["card"],
                    from_transaction=tx,
                    notes="カード引落",
                    created_by=self.user,
                )
            elif meta.get("transfer") == "savings":
                savings_balance += 50_000
                to_tx = NormalizedTransaction.objects.create(
                    account=savings,
                    date=tx_date,
                    amount=yen(50_000),
                    balance=yen(savings_balance),
                    description="振替 メイン口座",
                    created_by=self.user,
                )
                Transfer.objects.create(
                    date=tx_date,
                    amount=yen(50_000),
                    from_account=main,
                    to_account=savings,
                    from_transaction=tx,
                    to_transaction=to_tx,
                    notes="毎月の積立",
                    created_by=self.user,
                )

    def _create_cash_activity(self, anchor, accounts, categories):
        wallet = accounts["wallet"]
        first_start = shift_month(anchor, -(MONTHS - 1))
        AccountBalanceSnapshot.objects.create(
            account=wallet,
            as_of=first_start - timedelta(days=1),
            balance=yen(23_400),
            notes="期首残高",
            created_by=self.user,
        )
        for year, month, _start, end in self._months(anchor):
            for _ in range(self.rng.randint(5, 8)):
                tx_date = date(year, month, self.rng.randint(1, end.day))
                if tx_date > anchor:
                    continue
                label, category_name, (low, high) = self.rng.choice(CASH_ITEMS)
                HouseholdExpense.objects.create(
                    date=tx_date,
                    amount=yen(self.rng.randint(low, high)),
                    category=categories[category_name],
                    payment_account=wallet,
                    notes=label,
                    created_by=self.user,
                )
            if month % 3 == 0:
                adj_date = date(year, month, 12)
                if adj_date <= anchor:
                    CashAdjustment.objects.create(
                        payment_account=wallet,
                        date=adj_date,
                        direction=CashAdjustmentDirection.IN,
                        amount=yen(3_000),
                        category=CashAdjustmentCategory.REPAYMENT,
                        counterparty_name="友人",
                        notes="立替分の精算",
                        created_by=self.user,
                    )

    def _create_budgets(self, anchor, categories):
        for year, month, _start, _end in self._months(anchor):
            period = BudgetPeriod.objects.create(
                year=year, month=month, total_amount=BUDGET_TOTAL, created_by=self.user
            )
            for name, amount in BUDGETS.items():
                BudgetAllocation.objects.create(
                    period=period,
                    category=categories[name],
                    amount=yen(amount),
                    created_by=self.user,
                )

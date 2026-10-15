from django.db import models

from commons.models import BaseModel


def money_field(help_text: str) -> models.DecimalField:
    return models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=help_text,
    )


class CsvAmountRule(models.TextChoices):
    SIGNED = "signed", "符号付き"
    SPLIT = "split", "入金/出金カラム分離"
    USAGE = "usage", "利用額（カード明細）"


class CsvEncoding(models.TextChoices):
    CP932 = "cp932", "Shift_JIS"
    UTF8 = "utf-8", "UTF-8"


class CsvTemplate(BaseModel):
    name = models.CharField(max_length=100)
    notes = models.CharField("備考", max_length=255, blank=True)
    has_header = models.BooleanField(default=True)
    header_row_index = models.PositiveIntegerField(default=0)
    date_formats = models.JSONField(default=list, blank=True)
    encoding = models.CharField(
        "文字コード",
        max_length=20,
        choices=CsvEncoding.choices,
        default=CsvEncoding.CP932,
    )
    amount_rule = models.CharField(
        max_length=20,
        choices=CsvAmountRule.choices,
        default=CsvAmountRule.SPLIT,
    )
    signed_amount_column = models.CharField(max_length=100, blank=True)
    deposit_column = models.CharField(max_length=100, blank=True)
    withdrawal_column = models.CharField(max_length=100, blank=True)
    date_column = models.CharField(max_length=100, blank=True)
    description_column = models.CharField(max_length=100, blank=True)
    balance_column = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class PaymentAccountType(models.TextChoices):
    BANK = "bank", "銀行口座"
    CREDIT_CARD = "credit_card", "クレジットカード"
    CASH = "cash", "現金"


class PaymentAccount(BaseModel):
    """
    決済手段の共通モデル。type で銀行口座 / クレジットカード / 現金を区別する。
    """

    type = models.CharField(
        "種別",
        max_length=20,
        choices=PaymentAccountType.choices,
        default=PaymentAccountType.BANK,
    )
    name = models.CharField(max_length=100, help_text="表示名")
    display_order = models.PositiveIntegerField(default=0)
    notes = models.CharField("備考", max_length=255, blank=True)
    is_archived = models.BooleanField("使用停止", default=False)
    reference_url = models.URLField(
        max_length=500,
        blank=True,
        help_text="CSVダウンロード／明細ページ等の参照URL",
    )
    default_csv_template = models.ForeignKey(
        CsvTemplate,
        on_delete=models.SET_NULL,
        related_name="default_for_accounts",
        null=True,
        blank=True,
        help_text="CSVテンプレートの既定値",
    )

    # 銀行口座 (type=bank)
    branch_name = models.CharField("支店名", max_length=100, blank=True)
    account_number = models.CharField("口座番号", max_length=50, blank=True)

    # クレジットカード (type=credit_card)
    issuer = models.CharField("発行会社", max_length=100, blank=True)
    last4 = models.CharField("カード番号下4桁", max_length=4, blank=True)
    closing_day = models.PositiveSmallIntegerField(
        "締め日", null=True, blank=True, help_text="月の何日に締めるか（1〜31）"
    )
    payment_day = models.PositiveSmallIntegerField(
        "引落日", null=True, blank=True, help_text="月の何日に引き落とすか（1〜31）"
    )

    class Meta:
        ordering = ["display_order", "id"]

    def __str__(self) -> str:
        return self.name


class BankAccountManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(type=PaymentAccountType.BANK)

    def create(self, **kwargs):
        kwargs.setdefault("type", PaymentAccountType.BANK)
        return super().create(**kwargs)


class BankAccount(PaymentAccount):
    objects = BankAccountManager()

    class Meta:
        proxy = True
        verbose_name = "銀行口座"
        verbose_name_plural = "銀行口座"


class CreditCardAccountManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(type=PaymentAccountType.CREDIT_CARD)

    def create(self, **kwargs):
        kwargs.setdefault("type", PaymentAccountType.CREDIT_CARD)
        return super().create(**kwargs)


class CreditCardAccount(PaymentAccount):
    objects = CreditCardAccountManager()

    class Meta:
        proxy = True
        verbose_name = "クレジットカード"
        verbose_name_plural = "クレジットカード"


class CashWalletManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(type=PaymentAccountType.CASH)

    def create(self, **kwargs):
        kwargs.setdefault("type", PaymentAccountType.CASH)
        return super().create(**kwargs)


class CashWallet(PaymentAccount):
    objects = CashWalletManager()

    class Meta:
        proxy = True
        verbose_name = "現金"
        verbose_name_plural = "現金"


class FinancialAsset(BaseModel):
    """
    スナップショット運用の金融資産（投資信託・株式・暗号資産など）。
    PaymentAccount とは別概念で、支払元にはならない。
    """

    name = models.CharField(max_length=100, help_text="表示名")
    display_order = models.PositiveIntegerField(default=0)
    reference_url = models.URLField(
        max_length=500,
        blank=True,
        help_text="資産ページのURL",
    )

    class Meta:
        ordering = ["display_order", "id"]

    def __str__(self) -> str:
        return self.name


class AccountBalanceSnapshot(BaseModel):
    """
    PaymentAccount（銀行・現金・クレカ）の残高スナップショット。
    """

    account = models.ForeignKey(
        PaymentAccount,
        on_delete=models.CASCADE,
        related_name="snapshots",
    )
    as_of = models.DateField(help_text="残高日時")
    balance = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.CharField("備考", max_length=255, blank=True)

    class Meta:
        ordering = ["-as_of", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "as_of"],
                name="unique_snapshot_per_day",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.account} @ {self.as_of}: {self.balance}"


class FinancialAssetSnapshot(BaseModel):
    """
    Snapshot for financial assets.
    """

    financial_asset = models.ForeignKey(
        FinancialAsset,
        on_delete=models.CASCADE,
        related_name="snapshots",
    )
    as_of = models.DateField(help_text="評価日")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.CharField("備考", max_length=255, blank=True)

    class Meta:
        ordering = ["-as_of", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["financial_asset", "as_of"],
                name="unique_financial_asset_snapshot_per_day",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.financial_asset} @ {self.as_of}: {self.amount}"


class NormalizedTransactionQuerySet(models.QuerySet):
    def exclude_transfer_linked(self):
        """振替 (Transfer) に紐づく明細を除外する。

        振替済の明細は口座間の資金移動であり、収入・支出ではないため
        収支集計から外す。from / to のどちらに紐づいていても除外する。
        """
        return self.exclude(transfer_as_source__isnull=False).exclude(
            transfer_as_destination__isnull=False
        )


class NormalizedTransaction(BaseModel):
    account = models.ForeignKey(
        PaymentAccount,
        on_delete=models.CASCADE,
        related_name="normalized_transactions",
    )
    date = models.DateField()
    amount = money_field("入出金金額")
    balance = money_field("差引残高")
    description = models.CharField(max_length=255, blank=True)
    notes = models.TextField("備考", blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)

    objects = NormalizedTransactionQuerySet.as_manager()

    class Meta:
        ordering = ["date", "id"]
        indexes = [
            models.Index(fields=["account", "date"]),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.description}".strip()


class CashAdjustmentDirection(models.TextChoices):
    IN = "in", "受領"
    OUT = "out", "贈与"


class CashAdjustmentCategory(models.TextChoices):
    ALLOWANCE = "allowance", "お小遣い"
    GIFT = "gift", "贈与・ご祝儀"
    REPAYMENT = "repayment", "立替精算"
    OTHER = "other", "その他"


class CashAdjustment(BaseModel):
    """
    人と人との現金授受 (お小遣い、贈与、立替精算など) を表す。
    現金口座の残高に影響するが、家計支出・収入とは独立した別軸の記録。
    """

    payment_account = models.ForeignKey(
        PaymentAccount,
        on_delete=models.PROTECT,
        related_name="cash_adjustments",
        limit_choices_to={"type": PaymentAccountType.CASH},
        verbose_name="現金口座",
    )
    date = models.DateField("発生日")
    direction = models.CharField(
        "方向",
        max_length=8,
        choices=CashAdjustmentDirection.choices,
    )
    amount = models.DecimalField("金額", max_digits=14, decimal_places=2)
    category = models.CharField(
        "種別",
        max_length=20,
        choices=CashAdjustmentCategory.choices,
        default=CashAdjustmentCategory.OTHER,
    )
    counterparty_name = models.CharField(
        "相手", max_length=100, blank=True, help_text="例: 家族、友人"
    )
    notes = models.CharField("備考", max_length=255, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["payment_account", "date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="cash_adjustment_amount_positive",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"{self.date} {self.get_direction_display()} {self.amount} ({self.counterparty_name})"
        )


class Transfer(BaseModel):
    """
    口座間の振替・クレジットカード引落・ATM出金などを表現する。
    from_transaction / to_transaction で実際の明細行と紐付けできる。
    """

    date = models.DateField("発生日")
    amount = models.DecimalField("金額", max_digits=14, decimal_places=2)
    from_account = models.ForeignKey(
        PaymentAccount,
        on_delete=models.PROTECT,
        related_name="transfers_out",
        verbose_name="送金元",
    )
    to_account = models.ForeignKey(
        PaymentAccount,
        on_delete=models.PROTECT,
        related_name="transfers_in",
        verbose_name="送金先",
    )
    from_transaction = models.ForeignKey(
        NormalizedTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transfer_as_source",
        verbose_name="送金元明細",
    )
    to_transaction = models.ForeignKey(
        NormalizedTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transfer_as_destination",
        verbose_name="送金先明細",
    )
    notes = models.CharField("備考", max_length=255, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(from_account=models.F("to_account")),
                name="transfer_from_to_must_differ",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.from_account} → {self.to_account}: {self.amount}"

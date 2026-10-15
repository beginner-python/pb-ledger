import uuid
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q, Sum

from commons.models import BaseModel


class HouseholdCategory(BaseModel):
    name = models.CharField("カテゴリ名", max_length=100)
    slug = models.UUIDField("識別名", default=uuid.uuid4, unique=True, editable=False)
    parent = models.ForeignKey(
        "self",
        verbose_name="親カテゴリ",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )
    color = models.CharField(
        "表示色", max_length=7, blank=True, help_text="HEXカラーで表示します。"
    )
    notes = models.TextField("備考", blank=True)

    class Meta:
        verbose_name = "家計カテゴリ"
        verbose_name_plural = "家計カテゴリ"
        ordering = ["name"]
        unique_together = (("parent", "name"),)
        constraints = [
            models.UniqueConstraint(
                fields=["name"],
                condition=Q(parent__isnull=True),
                name="uniq_householdcategory_name_no_parent",
            )
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if self.parent_id is None:
            return
        if self.pk is not None and self.parent_id == self.pk:
            raise ValidationError({"parent": "親カテゴリに自身は設定できません。"})
        # 2階層固定: 親に指定できるのはトップレベル (parent_id IS NULL) のみ。
        parent = self.parent
        if parent.parent_id is not None:
            raise ValidationError(
                {"parent": "カテゴリの階層は2段までです。子カテゴリを親には指定できません。"}
            )
        # 子を持つカテゴリは子になれない。
        if self.pk is not None and self.children.exists():
            raise ValidationError(
                {"parent": "子カテゴリを持つカテゴリは、別カテゴリの子にできません。"}
            )


class BudgetPeriod(BaseModel):
    year = models.PositiveSmallIntegerField(
        "対象年",
        validators=[MinValueValidator(2000), MaxValueValidator(2100)],
    )
    month = models.PositiveSmallIntegerField(
        "対象月",
        validators=[MinValueValidator(1), MaxValueValidator(12)],
    )
    total_amount = models.DecimalField(
        "月の総予算",
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
        help_text="カテゴリ予算とは別に設定する月全体の支出上限。",
    )
    notes = models.TextField("備考", blank=True)

    class Meta:
        verbose_name = "予算期間"
        verbose_name_plural = "予算期間"
        ordering = ["-year", "-month"]
        unique_together = (("year", "month"),)

    def __str__(self):
        return f"{self.year}-{self.month:02d}"


class BudgetAllocation(BaseModel):
    period = models.ForeignKey(
        BudgetPeriod,
        verbose_name="予算期間",
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    category = models.ForeignKey(
        HouseholdCategory,
        verbose_name="カテゴリ",
        on_delete=models.CASCADE,
        related_name="budget_allocations",
    )
    amount = models.DecimalField(
        "予算金額",
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    notes = models.TextField("備考", blank=True)

    class Meta:
        verbose_name = "予算"
        verbose_name_plural = "予算"
        unique_together = (("period", "category"),)
        ordering = ["period", "category__name"]

    def __str__(self):
        return f"{self.period} / {self.category.name}"

    def clean(self):
        """親予算 ≥ Σ子予算 を保証する。

        API view (BudgetCreateAPIView/BudgetDetailAPIView) は独自に
        ``_validate_parent_child_budget_constraint`` で同じ制約を検証する
        が、Django admin やシェルからの直接保存ではそれを通らない。
        モデル側でも担保しておくことで、いずれの経路でも違反を防ぐ。
        """
        super().clean()
        if self.category_id is None or self.period_id is None or self.amount is None:
            return

        category = self.category
        amount = Decimal(self.amount)

        if category.parent_id is not None:
            # 子カテゴリ: 親に予算があれば Σ既存子(本人除く) + amount ≤ 親予算
            parent_allocation = (
                BudgetAllocation.objects.filter(
                    period_id=self.period_id, category_id=category.parent_id
                )
                .only("amount")
                .first()
            )
            if parent_allocation is None:
                return
            sibling_qs = BudgetAllocation.objects.filter(
                period_id=self.period_id, category__parent_id=category.parent_id
            )
            if self.pk is not None:
                sibling_qs = sibling_qs.exclude(pk=self.pk)
            sibling_total = sibling_qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")
            if sibling_total + amount > parent_allocation.amount:
                raise ValidationError(
                    {
                        "amount": (
                            "子予算の合計が親カテゴリ予算を超えます "
                            f"(子合計 {sibling_total + amount} > 親 {parent_allocation.amount})。"
                        )
                    }
                )
            return

        # 親カテゴリ: amount ≥ Σ子予算
        children_total = BudgetAllocation.objects.filter(
            period_id=self.period_id, category__parent_id=category.id
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        if amount < children_total:
            raise ValidationError(
                {"amount": (f"親予算が子予算の合計 {children_total} 円を下回ります。")}
            )


class HouseholdExpense(BaseModel):
    date = models.DateField("発生日")
    amount = models.DecimalField(
        "金額",
        max_digits=12,
        decimal_places=2,
    )
    notes = models.CharField("備考", max_length=255, blank=True)
    category = models.ForeignKey(
        HouseholdCategory,
        verbose_name="カテゴリ",
        on_delete=models.PROTECT,
        related_name="expenses",
    )
    payment_account = models.ForeignKey(
        "ledger.PaymentAccount",
        verbose_name="支払元",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
        help_text="銀行口座／クレジットカード／現金のいずれか",
    )
    source_transaction = models.ForeignKey(
        "ledger.NormalizedTransaction",
        verbose_name="紐付け明細",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
        help_text="1つの明細を複数の支出に分割可能",
    )
    source_cash_adjustment = models.ForeignKey(
        "ledger.CashAdjustment",
        verbose_name="紐付け現金入出",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
        help_text="現金口座の入出（OUT）から作成された支出と紐付ける",
    )

    class Meta:
        verbose_name = "家計支出"
        verbose_name_plural = "家計支出"
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["payment_account", "date"]),
        ]

    def __str__(self):
        return f"{self.date.isoformat()} {self.category.name} {self.amount}"

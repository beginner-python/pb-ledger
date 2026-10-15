from django.contrib import admin

from commons.admin import AuditAdminMixin
from ledger import models


@admin.register(models.PaymentAccount)
class PaymentAccountAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "type",
        "display_order",
        "is_archived",
        "default_csv_template",
    )
    list_filter = ("type", "is_archived")
    search_fields = ("name", "branch_name", "account_number", "issuer", "last4")
    ordering = ("display_order", "id")


@admin.register(models.BankAccount)
class BankAccountAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "branch_name",
        "account_number",
        "display_order",
        "default_csv_template",
    )
    search_fields = ("name", "branch_name", "account_number")
    ordering = ("display_order", "id")


@admin.register(models.CreditCardAccount)
class CreditCardAccountAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "issuer",
        "last4",
        "closing_day",
        "payment_day",
    )
    search_fields = ("name", "issuer", "last4")
    ordering = ("display_order", "id")


@admin.register(models.CashWallet)
class CashWalletAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "display_order", "is_archived")
    search_fields = ("name",)
    ordering = ("display_order", "id")


@admin.register(models.AccountBalanceSnapshot)
class AccountBalanceSnapshotAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("account", "as_of", "balance", "notes")
    search_fields = ("notes",)
    list_filter = ("account", "as_of")
    ordering = ("-as_of", "-id")


@admin.register(models.FinancialAsset)
class FinancialAssetAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "display_order")
    search_fields = ("name",)
    ordering = ("display_order", "id")


@admin.register(models.FinancialAssetSnapshot)
class FinancialAssetSnapshotAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("financial_asset", "as_of", "amount", "notes")
    search_fields = ("notes",)
    list_filter = ("financial_asset", "as_of")
    ordering = ("-as_of", "-id")


@admin.register(models.NormalizedTransaction)
class NormalizedTransactionAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("date", "account", "amount", "balance", "description")
    search_fields = ("description", "notes")
    list_filter = ("account", "date")
    ordering = ("-date", "-id")


@admin.register(models.Transfer)
class TransferAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("date", "from_account", "to_account", "amount")
    search_fields = ("notes",)
    list_filter = ("date",)
    ordering = ("-date", "-id")


@admin.register(models.CashAdjustment)
class CashAdjustmentAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = (
        "date",
        "payment_account",
        "direction",
        "amount",
        "category",
        "counterparty_name",
    )
    list_filter = ("payment_account", "direction", "category", "date")
    search_fields = ("counterparty_name", "notes")
    ordering = ("-date", "-id")


@admin.register(models.CsvTemplate)
class CsvTemplateAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "amount_rule", "has_header")
    search_fields = ("name", "notes")
    list_filter = ("amount_rule", "has_header")
    ordering = ("name", "id")

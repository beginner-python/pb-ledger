from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from household.models import BudgetAllocation, BudgetPeriod, HouseholdCategory
from ledger.models import (
    BankAccount,
    CashAdjustment,
    CashAdjustmentDirection,
    CashWallet,
    NormalizedTransaction,
)


class HouseholdAPITestCase(APITestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(email="tester@example.com", password="secret")
        self.client.force_authenticate(user=user)


class BudgetCreateTests(HouseholdAPITestCase):
    def test_duplicate_budget_returns_400_not_500(self):
        category = HouseholdCategory.objects.create(name="食費")
        payload = {
            "year": 2026,
            "month": 10,
            "category_id": category.id,
            "amount": "30000",
        }
        first = self.client.post(reverse("household_budgets"), payload, format="json")
        self.assertEqual(first.status_code, 201)

        second = self.client.post(reverse("household_budgets"), payload, format="json")
        self.assertEqual(second.status_code, 400)
        self.assertIn("既に存在", second.json()["detail"])
        self.assertEqual(BudgetAllocation.objects.count(), 1)


class CategoryParentChangeTests(HouseholdAPITestCase):
    def setUp(self):
        super().setUp()
        self.period = BudgetPeriod.objects.create(year=2026, month=10)
        self.parent = HouseholdCategory.objects.create(name="生活")
        self.existing_child = HouseholdCategory.objects.create(name="日用品", parent=self.parent)
        self.movable = HouseholdCategory.objects.create(name="趣味")
        BudgetAllocation.objects.create(
            period=self.period, category=self.parent, amount=Decimal("30000")
        )
        BudgetAllocation.objects.create(
            period=self.period, category=self.existing_child, amount=Decimal("20000")
        )

    def _move(self, amount: str):
        BudgetAllocation.objects.create(
            period=self.period, category=self.movable, amount=Decimal(amount)
        )
        return self.client.patch(
            reverse("household_category_detail", args=[self.movable.id]),
            {"name": "趣味", "parent_id": self.parent.id},
            format="json",
        )

    def test_moving_child_that_breaks_parent_budget_is_rejected(self):
        res = self._move("50000")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "child_budget_exceeds_parent")
        self.movable.refresh_from_db()
        self.assertIsNone(self.movable.parent_id)

    def test_moving_child_within_parent_budget_is_allowed(self):
        res = self._move("10000")
        self.assertEqual(res.status_code, 200)
        self.movable.refresh_from_db()
        self.assertEqual(self.movable.parent_id, self.parent.id)


class ExpenseSourceValidationTests(HouseholdAPITestCase):
    def setUp(self):
        super().setUp()
        self.category = HouseholdCategory.objects.create(name="食費")
        self.bank = BankAccount.objects.create(name="銀行")
        self.cash = CashWallet.objects.create(name="財布")

    def _post(self, **extra):
        payload = {
            "category_id": self.category.id,
            "date": "2026-10-01",
            "amount": "1000",
            **extra,
        }
        return self.client.post(reverse("household_expenses"), payload, format="json")

    def test_deposit_transaction_cannot_be_expense_source(self):
        tx = NormalizedTransaction.objects.create(
            account=self.bank, date=date(2026, 10, 1), amount=Decimal("5000")
        )
        res = self._post(source_transaction_id=tx.id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "source_transaction_not_withdrawal")

    def test_transaction_without_amount_cannot_be_expense_source(self):
        tx = NormalizedTransaction.objects.create(
            account=self.bank, date=date(2026, 10, 1), amount=None
        )
        res = self._post(source_transaction_id=tx.id)
        self.assertEqual(res.status_code, 400)

    def test_withdrawal_transaction_sets_payment_account(self):
        tx = NormalizedTransaction.objects.create(
            account=self.bank, date=date(2026, 10, 1), amount=Decimal("-5000")
        )
        res = self._post(source_transaction_id=tx.id)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["paymentAccountId"], self.bank.id)

    def test_transaction_and_cash_adjustment_cannot_both_be_sources(self):
        tx = NormalizedTransaction.objects.create(
            account=self.bank, date=date(2026, 10, 1), amount=Decimal("-5000")
        )
        adj = CashAdjustment.objects.create(
            payment_account=self.cash,
            date=date(2026, 10, 1),
            direction=CashAdjustmentDirection.OUT,
            amount=Decimal("5000"),
        )
        res = self._post(source_transaction_id=tx.id, source_cash_adjustment_id=adj.id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "expense_multiple_sources")

    def test_incoming_cash_adjustment_cannot_be_expense_source(self):
        adj = CashAdjustment.objects.create(
            payment_account=self.cash,
            date=date(2026, 10, 1),
            direction=CashAdjustmentDirection.IN,
            amount=Decimal("5000"),
        )
        res = self._post(source_cash_adjustment_id=adj.id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "source_cash_adjustment_not_out")

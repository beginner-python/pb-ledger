from decimal import Decimal

from django.test import TestCase

from ledger.api.csv_import import import_transactions_with_template
from ledger.models import (
    CreditCardAccount,
    CsvAmountRule,
    CsvTemplate,
    NormalizedTransaction,
)

HEADER = "利用日,利用店名・商品名,利用金額\n"


class ImportDedupTests(TestCase):
    """CSV 再取り込み時の重複排除。

    カード会社が摘要の表記を変えた CSV を再取り込みしても同じ利用が
    二重登録されないこと、かつ同日・同額の正当な複数利用は失われないこと。
    """

    def setUp(self):
        self.account = CreditCardAccount.objects.create(name="テストカード")
        self.template = CsvTemplate.objects.create(
            name="テスト",
            has_header=True,
            header_row_index=0,
            date_formats=["%Y/%m/%d"],
            amount_rule=CsvAmountRule.USAGE,
            signed_amount_column="利用金額",
            date_column="利用日",
            description_column="利用店名・商品名",
        )

    def _import(self, body: str) -> int:
        created, error = import_transactions_with_template(
            account=self.account,
            template=self.template,
            decoded_csv=HEADER + body,
        )
        self.assertIsNone(error)
        return created

    def _descriptions(self) -> list[str]:
        return list(
            NormalizedTransaction.objects.filter(account=self.account)
            .order_by("id")
            .values_list("description", flat=True)
        )

    def test_first_import_creates_all_rows(self):
        created = self._import(
            "2026/04/30,カード利用　アイスクリーム店　        705111,840\n"
            "2026/05/02,ＶＩＳＡ国内利用　VS ｲｵﾓｰﾙ,4060\n"
        )
        self.assertEqual(created, 2)

    def test_identical_reimport_creates_nothing(self):
        body = "2026/04/30,カード利用　アイスクリーム店　        705111,840\n"
        self._import(body)
        self.assertEqual(self._import(body), 0)

    def test_reimport_with_changed_description_creates_nothing(self):
        self._import(
            "2026/04/30,カード利用　アイスクリーム店　        705111,840\n"
            "2026/05/02,ＶＩＳＡ国内利用　VS ｲｵﾓｰﾙ,4060\n"
            "2026/05/07,ＶＩＳＡ海外利用　OPENAI *CHATGPT SUBS,3601\n"
        )
        created = self._import(
            "2026/04/30,カード利用　アイスクリーム店,840\n"
            "2026/05/02,ｲｵﾓｰﾙ,4060\n"
            "2026/05/07,OPENAI *CHATGPT SUBS利用国US,3601\n"
        )
        self.assertEqual(created, 0)
        self.assertEqual(NormalizedTransaction.objects.count(), 3)
        # 既存行の摘要はそのまま残る
        self.assertIn("カード利用　アイスクリーム店　        705111", self._descriptions())

    def test_same_day_same_amount_distinct_purchases_are_kept(self):
        # 同日・同額で店が違う 2 件は初回に 2 件とも登録される
        created = self._import(
            "2026/05/30,カード利用　衣料品アプリ　        700777,990\n"
            "2026/05/30,カード利用　生活雑貨店　        703959,990\n"
        )
        self.assertEqual(created, 2)
        # 摘要が変わった再取り込みでも増えない
        created = self._import(
            "2026/05/30,カード利用　衣料品アプリ,990\n2026/05/30,カード利用　生活雑貨店,990\n"
        )
        self.assertEqual(created, 0)
        self.assertEqual(NormalizedTransaction.objects.count(), 2)

    def test_new_purchase_on_same_day_and_amount_is_added(self):
        self._import("2026/08/29,ＥＴＣカード売上　ｱﾂｷﾞ       ｱﾔｾｽﾏ-ﾄ,360\n")
        # 既存 1 件 + 新規 1 件 (別の料金所、同額) → 1 件だけ増える
        created = self._import(
            "2026/08/29,ＥＴＣカード売上　ｱﾂｷﾞ       ｱﾔｾｽﾏ-ﾄ,360\n"
            "2026/08/29,ＥＴＣカード売上　ｱﾔｾｽﾏ-ﾄ    ｱﾂｷﾞ,360\n"
        )
        self.assertEqual(created, 1)
        self.assertEqual(NormalizedTransaction.objects.count(), 2)

    def test_exact_match_consumes_existing_slot_before_renamed_row(self):
        # 既存: A, B。CSV: A (完全一致), C (B の表記変更) → C はスキップされる
        self._import("2026/06/01,店A,500\n2026/06/01,店B,500\n")
        created = self._import("2026/06/01,店A,500\n2026/06/01,店B 表記変更,500\n")
        self.assertEqual(created, 0)

    def test_identical_rows_in_one_file_are_separate_transactions(self):
        # 同じ店・同日・同額の 2 行 (カード会社の CSV では実際に別利用として並ぶ)
        row = "2026/08/10,カード利用　駅前商業施設,1080\n"
        body = row * 2
        self.assertEqual(self._import(body), 2)
        self.assertEqual(NormalizedTransaction.objects.count(), 2)
        # 同じファイルを再取り込みしても増えない
        self.assertEqual(self._import(body), 0)
        self.assertEqual(NormalizedTransaction.objects.count(), 2)

    def test_identical_row_added_to_partially_imported_group(self):
        # 既存 1 件に対して、同内容 2 行の CSV → 1 件だけ追加される
        self._import("2026/08/10,カード利用　駅前商業施設,1080\n")
        created = self._import(
            "2026/08/10,カード利用　駅前商業施設,1080\n2026/08/10,カード利用　駅前商業施設,1080\n"
        )
        self.assertEqual(created, 1)
        self.assertEqual(NormalizedTransaction.objects.count(), 2)

    def test_exact_rows_consume_their_own_slots_first(self):
        # 既存: A, B。CSV: A, A, B → 追加は 2 つ目の A のみ。
        # (B の表記変更として扱わない)
        self._import("2026/06/01,店A,500\n2026/06/01,店B,500\n")
        created = self._import("2026/06/01,店A,500\n2026/06/01,店A,500\n2026/06/01,店B,500\n")
        self.assertEqual(created, 1)
        self.assertEqual(sorted(self._descriptions()), ["店A", "店A", "店B"])

    def test_amount_is_stored_negative_for_usage_rule(self):
        self._import("2026/04/30,店,840\n")
        tx = NormalizedTransaction.objects.get()
        self.assertEqual(tx.amount, Decimal("-840"))


class ImportLimitTests(TestCase):
    """CSV 取込の上限。巨大ファイルを全行メモリに展開しない。"""

    def setUp(self):
        self.account = CreditCardAccount.objects.create(name="テストカード")
        self.template = CsvTemplate.objects.create(
            name="テスト",
            has_header=True,
            date_formats=["%Y/%m/%d"],
            amount_rule="usage",
            date_column="利用日",
            description_column="利用店名・商品名",
            withdrawal_column="利用金額",
        )

    def test_rejects_too_many_rows(self):
        from ledger.api.csv_import import MAX_CSV_ROWS

        body = "2026/08/10,テスト店,100\n" * (MAX_CSV_ROWS + 1)
        created, error = import_transactions_with_template(
            account=self.account, template=self.template, decoded_csv=HEADER + body
        )
        self.assertEqual(created, 0)
        self.assertIn("行以下", error)
        self.assertEqual(NormalizedTransaction.objects.count(), 0)

    def test_rejects_oversized_file(self):
        from ledger.api.csv_import import MAX_CSV_UPLOAD_BYTES

        padding = "x" * (MAX_CSV_UPLOAD_BYTES + 1)
        created, error = import_transactions_with_template(
            account=self.account, template=self.template, decoded_csv=HEADER + padding
        )
        self.assertEqual(created, 0)
        self.assertIn("MB 以下", error)


class AccountDeleteTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient

        self.client = APIClient()
        user = get_user_model().objects.create_user(email="tester@example.com", password="secret")
        self.client.force_authenticate(user=user)

    def test_account_with_transfers_is_not_deleted_and_returns_409(self):
        from datetime import date

        from django.urls import reverse

        from ledger.models import BankAccount, CashWallet, Transfer

        bank = BankAccount.objects.create(name="銀行")
        cash = CashWallet.objects.create(name="財布")
        Transfer.objects.create(
            date=date(2026, 10, 1),
            amount=Decimal("10000"),
            from_account=bank,
            to_account=cash,
        )

        url = reverse("ledger_accounts_detail", args=[bank.id])
        res = self.client.delete(f"{url}?asset_kind=bank_account")
        self.assertEqual(res.status_code, 409)
        self.assertIn("振替 1 件", res.json()["error"])
        self.assertTrue(BankAccount.objects.filter(id=bank.id).exists())


class AccountTransactionsPayloadTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient

        self.client = APIClient()
        user = get_user_model().objects.create_user(email="tester@example.com", password="secret")
        self.client.force_authenticate(user=user)

    def test_null_balance_is_serialized_as_null_and_transfer_notes_are_exposed(self):
        from datetime import date

        from django.urls import reverse

        from ledger.models import BankAccount, CashWallet, Transfer

        bank = BankAccount.objects.create(name="銀行")
        cash = CashWallet.objects.create(name="財布")
        tx = NormalizedTransaction.objects.create(
            account=bank, date=date(2026, 10, 5), amount=Decimal("-3000"), balance=None
        )
        Transfer.objects.create(
            date=date(2026, 10, 6),
            amount=Decimal("3000"),
            from_account=bank,
            to_account=cash,
            from_transaction=tx,
            notes="ATM 出金",
        )

        res = self.client.get(
            reverse("ledger_account_transactions", args=[bank.id]) + "?month=2026-10"
        )
        self.assertEqual(res.status_code, 200)
        row = res.json()["transactions"][0]
        self.assertIsNone(row["balance"])
        self.assertEqual(row["linkedTransferNotes"], "ATM 出金")
        self.assertEqual(row["linkedTransferDate"], "2026-10-06")

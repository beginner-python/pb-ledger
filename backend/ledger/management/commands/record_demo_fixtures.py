"""
デモ用に API の GET 応答を JSON へ記録する。

seed_demo で投入したデータに対して、フロントが実際に叩くエンドポイントを
DRF の APIClient で呼び出し、応答をそのまま保存する。保存した JSON は
フロントの MSW (Mock Service Worker) が返すため、公開デモはバックエンド無しで動く。
"""

import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from rest_framework.test import APIClient

from household.models import HouseholdExpense
from ledger.models import FinancialAsset, PaymentAccount, PaymentAccountType

from .seed_demo import DEMO_EMAIL, MONTHS, shift_month

KIND_BY_TYPE = {
    PaymentAccountType.BANK: "bank_account",
    PaymentAccountType.CREDIT_CARD: "credit_card",
    PaymentAccountType.CASH: "cash",
}


def normalize_key(method: str, url: str) -> str:
    """`GET /api/x/?b=2&a=1` と `GET /api/x/?a=1&b=2` を同じキーにする。"""
    parts = urlsplit(url)
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    return f"{method.upper()} {parts.path}" + (f"?{query}" if query else "")


class Command(BaseCommand):
    help = "Record demo API responses as JSON fixtures for the static demo."

    def add_arguments(self, parser):
        parser.add_argument("--anchor", help="基準日 (YYYY-MM-DD)。seed_demo と揃える。")
        parser.add_argument(
            "--out",
            default=str(
                Path(__file__).resolve().parents[4]
                / "frontend"
                / "src"
                / "mocks"
                / "fixtures"
                / "recorded.json"
            ),
            help="出力先 JSON のパス",
        )

    def handle(self, *args, **options):
        anchor = date.fromisoformat(options["anchor"]) if options["anchor"] else date.today()
        user = get_user_model().objects.filter(email=DEMO_EMAIL).first()
        if user is None:
            raise CommandError("先に seed_demo を実行してください。")

        # 開発設定の ALLOWED_HOSTS に合わせる (テストクライアント既定の testserver は含まれない)
        client = APIClient(HTTP_HOST="localhost")
        client.force_authenticate(user=user)

        responses: dict[str, dict] = {}
        skipped: list[str] = []

        def record(url: str):
            key = normalize_key("GET", url)
            if key in responses:
                return
            res = client.get(url)
            if res.status_code == 405:
                skipped.append(url)
                return
            body = json.loads(res.content.decode("utf-8")) if res.content else None
            responses[key] = {"status": res.status_code, "body": body}

        accounts = list(PaymentAccount.objects.order_by("display_order", "id"))
        assets = list(FinancialAsset.objects.order_by("display_order", "id"))

        # 月に依存しないもの
        record("/api/household/categories/")
        record("/api/household/expenses/years/")
        record("/api/ledger/payment-accounts/")
        for account in accounts:
            kind = KIND_BY_TYPE[account.type]
            record(f"/api/ledger/accounts/{account.id}/csv-templates/")
            record(f"/api/ledger/snapshots/?assetKind={kind}&accountId={account.id}")
        for asset in assets:
            record(f"/api/ledger/snapshots/?assetKind=financial_asset&accountId={asset.id}")

        # 月ごと: 画面で遡れる範囲 + 前後 1 か月
        for offset in range(-MONTHS, 2):
            start = shift_month(anchor, offset)
            label = f"{start.year}-{start.month:02d}"
            ym = f"year={start.year}&month={start.month}"
            record(f"/api/ledger/assets/?month={label}")
            record(f"/api/ledger/monthly-summary/?month={label}")
            record(f"/api/ledger/transfers/?month={label}")
            record(f"/api/household/expenses/?{ym}")
            record(f"/api/household/expenses/summary/?{ym}")
            record(f"/api/household/budgets/summary/?{ym}")
            record(f"/api/household/budgets/?{ym}")
            for account in accounts:
                record(f"/api/ledger/accounts/{account.id}/transactions/?limit=200&month={label}")
                record(
                    f"/api/household/expenses/?{ym}&paymentAccountId={account.id}&unlinkedOnly=true"
                )
                if account.type == PaymentAccountType.CASH:
                    record(f"/api/ledger/accounts/{account.id}/cash-history/?month={label}")

        # 年次レポートは対象年と前年の 12 か月分の summary を全て要求する
        for year in (anchor.year - 1, anchor.year):
            for month in range(1, 13):
                record(f"/api/household/expenses/summary/?year={year}&month={month}")

        # 明細に紐づく支出の一覧 (明細行の「紐付けを見る」用)
        tx_ids = (
            HouseholdExpense.objects.filter(source_transaction__isnull=False)
            .values_list("source_transaction_id", flat=True)
            .distinct()
        )
        for tx_id in tx_ids:
            record(f"/api/household/expenses/?sourceTransactionId={tx_id}")

        out_path = Path(options["out"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "anchorDate": anchor.isoformat(),
            "anchorMonth": f"{anchor.year}-{anchor.month:02d}",
            "demoEmail": DEMO_EMAIL,
            "responses": responses,
        }
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )

        # フロントの demo モードに基準月を渡す
        env_path = out_path.parents[3] / ".env.demo"
        env_path.write_text(
            "# record_demo_fixtures が生成。デモの初期表示月。\n"
            f"VITE_DEMO_ANCHOR_MONTH={payload['anchorMonth']}\n",
            encoding="utf-8",
        )

        non_200 = [k for k, v in responses.items() if v["status"] != 200]
        self.stdout.write(
            self.style.SUCCESS(
                f"Recorded {len(responses)} responses -> {out_path} "
                f"({out_path.stat().st_size // 1024} KB)"
            )
        )
        if skipped:
            self.stdout.write(f"Skipped (405): {', '.join(skipped)}")
        if non_200:
            self.stdout.write(self.style.WARNING("Non-200 responses:"))
            for key in non_200:
                self.stdout.write(f"  {responses[key]['status']} {key}")

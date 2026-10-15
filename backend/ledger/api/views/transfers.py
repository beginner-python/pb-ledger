"""口座間の振替 (カード引落、ATM 出金、積立など) と明細との紐付け。"""

from __future__ import annotations

from datetime import date

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api import schema as S
from ledger.api.parsing import InvalidAmountError, get_month_range, parse_amount
from ledger.models import (
    NormalizedTransaction,
    PaymentAccount,
    Transfer,
)


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
    @extend_schema(
        summary="振替の一覧 (月指定)",
        parameters=[S.MONTH_PARAM],
        responses={200: S.TransfersOut, 400: S.ErrorOut},
    )
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

    @extend_schema(
        summary="振替を登録 (明細との紐付けも可)",
        request=S.TransferIn,
        responses={201: S.TransferOut, 400: S.ErrorOut},
    )
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
    @extend_schema(summary="振替を削除", responses={200: S.DeletedOut, 404: S.ErrorOut})
    def delete(self, request, transfer_id):
        deleted, _ = Transfer.objects.filter(id=transfer_id).delete()
        if deleted == 0:
            return Response(
                {"error": "振替が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"deleted": 1})

    @extend_schema(
        summary="振替を更新",
        request=S.TransferPatchIn,
        responses={200: S.TransferOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
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

"""CSV テンプレートの登録と、テンプレートを使った明細の取込。"""

from __future__ import annotations

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.api import schema as S
from ledger.api.csv_import import (
    CSV_TOO_LARGE_ERROR,
    MAX_CSV_UPLOAD_BYTES,
    import_transactions_with_template,
)
from ledger.api.parsing import parse_bool_value
from ledger.models import (
    CsvAmountRule,
    CsvTemplate,
    PaymentAccount,
    PaymentAccountType,
)


class BankAccountCsvTemplateAPIView(APIView):
    @extend_schema(
        summary="口座の CSV テンプレート",
        responses={200: S.CsvTemplateOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
    def get(self, request, account_id):
        try:
            account = PaymentAccount.objects.select_related("default_csv_template").get(
                id=account_id
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if account.type == PaymentAccountType.CASH:
            return Response(
                {"error": "現金にはCSVテンプレートを設定できません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        template = account.default_csv_template
        if template is None:
            return Response(
                {"error": "CSVフォーマットが登録されていません。"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "name": template.name,
                "notes": template.notes,
                "has_header": template.has_header,
                "header_row_index": template.header_row_index,
                "date_formats": template.date_formats,
                "encoding": template.encoding,
                "amount_rule": template.amount_rule,
                "signed_amount_column": template.signed_amount_column,
                "deposit_column": template.deposit_column,
                "withdrawal_column": template.withdrawal_column,
                "date_column": template.date_column,
                "description_column": template.description_column,
                "balance_column": template.balance_column,
            }
        )

    @extend_schema(
        summary="CSV テンプレートを登録 (同時に明細の取込も可)",
        request={"multipart/form-data": S.CsvTemplateIn},
        responses={201: S.CsvTemplateCreatedOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
    def post(self, request, account_id):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response(
                {"error": "テンプレート名を入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        notes = (request.data.get("notes") or "").strip()

        raw_amount_rule = request.data.get("amount_rule")
        if raw_amount_rule is None:
            return Response(
                {"error": "入出金判定の設定をしてください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            amount_rule = CsvAmountRule(raw_amount_rule)
        except ValueError:
            return Response(
                {"error": "入出金判定の設定が不正です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_column = (request.data.get("date_column") or "").strip()
        if not date_column:
            return Response(
                {"error": "取引日のカラムを設定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        has_header = parse_bool_value(request.data.get("has_header", True), default=True)
        header_row_index = request.data.get("header_row_index", 0)
        try:
            header_row_index_value = max(0, int(header_row_index))
        except (TypeError, ValueError):
            return Response(
                {"error": "ヘッダー行/データ開始行は数値で入力してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_formats = request.data.get("date_formats") or []
        if isinstance(date_formats, str):
            date_formats = [fmt.strip() for fmt in date_formats.split(",") if fmt.strip()]
        if not isinstance(date_formats, list):
            return Response(
                {"error": "日付フォーマットの指定が不正です。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        register_records = parse_bool_value(
            request.data.get(
                "register_records",
                request.data.get("registerRecords", True),
            ),
            default=True,
        )
        encoding = request.data.get("encoding") or "cp932"
        if encoding not in {"cp932", "utf-8"}:
            return Response(
                {"error": "文字コードは cp932 または UTF-8 を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file = request.FILES.get("file")
        decoded_csv: str | None = None
        if register_records:
            if not file:
                return Response(
                    {"error": "CSVを登録する場合はCSVファイルを選択してください。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if file.size > MAX_CSV_UPLOAD_BYTES:
                return Response({"error": CSV_TOO_LARGE_ERROR}, status=status.HTTP_400_BAD_REQUEST)
            try:
                decoded_csv = file.read().decode(encoding)
            except UnicodeDecodeError:
                return Response(
                    {"error": "CSVの文字コードが一致しません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # UTF-8 BOM が残っていると 1 列目の列名が一致しなくなるので除去
            decoded_csv = decoded_csv.lstrip("﻿")

        with transaction.atomic():
            try:
                account = PaymentAccount.objects.get(id=account_id)
            except PaymentAccount.DoesNotExist:
                return Response(
                    {"error": "口座が見つかりません。"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if account.type == PaymentAccountType.CASH:
                return Response(
                    {"error": "現金にはCSVテンプレートを設定できません。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            template = CsvTemplate.objects.create(
                name=name,
                notes=notes,
                has_header=has_header,
                header_row_index=header_row_index_value,
                date_formats=date_formats,
                encoding=encoding,
                amount_rule=amount_rule,
                signed_amount_column=(request.data.get("signed_amount_column") or "").strip(),
                deposit_column=(request.data.get("deposit_column") or "").strip(),
                withdrawal_column=(request.data.get("withdrawal_column") or "").strip(),
                date_column=date_column,
                description_column=(request.data.get("description_column") or "").strip(),
                balance_column=(request.data.get("balance_column") or "").strip(),
            )

            account.default_csv_template = template
            account.save(update_fields=["default_csv_template"])

            created_count = 0
            if register_records:
                created_count, import_error = import_transactions_with_template(
                    account=account,
                    template=template,
                    decoded_csv=decoded_csv or "",
                )
                if import_error:
                    transaction.set_rollback(True)
                    return Response(
                        {"error": import_error},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        return Response(
            {
                "template_id": template.id,
                "account_id": account.id,
                "records_registered": register_records,
                "created": created_count,
            },
            status=status.HTTP_201_CREATED,
        )


class AccountCsvImportAPIView(APIView):
    @extend_schema(
        summary="テンプレートに従って CSV を取り込む",
        request={"multipart/form-data": S.CsvImportIn},
        responses={201: S.CreatedOut, 400: S.ErrorOut, 404: S.ErrorOut},
    )
    def post(self, request):
        file = request.FILES.get("file")
        account_id = request.data.get("account_id")

        if not file:
            return Response(
                {"error": "CSVファイルを選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not account_id:
            return Response(
                {"error": "取込先口座を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            account = PaymentAccount.objects.select_related("default_csv_template").get(
                id=account_id
            )
        except PaymentAccount.DoesNotExist:
            return Response(
                {"error": "取込先口座が見つかりません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if account.type == PaymentAccountType.CASH:
            return Response(
                {"error": "現金にはCSVから取り込めません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        template = account.default_csv_template
        if template is None:
            return Response(
                {"error": "CSVフォーマットが登録されていません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 文字コードはテンプレート保存値を優先（リクエストでの上書きを許容）
        encoding = request.data.get("encoding") or template.encoding or "cp932"
        if encoding not in {"cp932", "utf-8"}:
            return Response(
                {"error": "文字コードは cp932 または UTF-8 を指定してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if file.size > MAX_CSV_UPLOAD_BYTES:
            return Response({"error": CSV_TOO_LARGE_ERROR}, status=status.HTTP_400_BAD_REQUEST)
        try:
            decoded = file.read().decode(encoding)
        except UnicodeDecodeError:
            return Response(
                {"error": "CSVの文字コードが一致しません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        decoded = decoded.lstrip("﻿")

        created_count, import_error = import_transactions_with_template(
            account=account,
            template=template,
            decoded_csv=decoded,
        )
        if import_error:
            return Response(
                {"error": import_error},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "created": created_count,
            },
            status=status.HTTP_201_CREATED,
        )

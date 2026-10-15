import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'

type Props = {
  account: AssetAccount
  /** テンプレート保存後に呼ぶ。親は口座一覧を再取得してこのパネルを閉じる */
  onSaved: () => Promise<void>
}

/** CSV テンプレートの登録・編集。ファイルを読んで列を割り当て、保存時に明細も取り込める */
export default function CsvTemplatePanel({ account, onSaved }: Props) {
  const isBankAccount = account.assetKind === 'bank_account'
  const isCreditCard = account.assetKind === 'credit_card'
  const [isFormatView, setIsFormatView] = useState(false)
  const [formatStatus, setFormatStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [formatMessage, setFormatMessage] = useState<string>('')
  const [formatEncoding, setFormatEncoding] = useState<'shift-jis' | 'utf-8'>(
    'shift-jis'
  )
  const [formatFile, setFormatFile] = useState<File | null>(null)
  const [formatFileName, setFormatFileName] = useState<string>('')
  const [formatRows, setFormatRows] = useState<string[][]>([])
  const [formatHeaders, setFormatHeaders] = useState<string[]>([])
  const [registerRecordsOnSave, setRegisterRecordsOnSave] = useState<boolean>(true)
  const [formatForm, setFormatForm] = useState({
    name: '',
    headerRowCount: '1',
    dateColumn: '',
    dateFormats: '',
    amountRule: 'split',
    signedAmountColumn: '',
    depositColumn: '',
    withdrawalColumn: '',
    descriptionColumn: '',
    balanceColumn: '',
  })

  const parseCsv = (text: string) => {
    const rows: string[][] = []
    let currentRow: string[] = []
    let currentCell = ''
    let inQuotes = false

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]
      const nextChar = text[i + 1]
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
        continue
      }
      if (!inQuotes && (char === ',' || char === '\n' || char === '\r')) {
        if (char === '\r' && nextChar === '\n') {
          i += 1
        }
        currentRow.push(currentCell)
        currentCell = ''
        if (char !== ',') {
          rows.push(currentRow)
          currentRow = []
        }
        continue
      }
      currentCell += char
    }
    if (currentCell !== '' || currentRow.length > 0) {
      currentRow.push(currentCell)
      rows.push(currentRow)
    }
    return rows
  }

  const previewRows = useMemo(() => {
    const headerCount = Math.max(0, Number(formatForm.headerRowCount || 0))
    return formatRows.slice(headerCount, headerCount + 12)
  }, [formatRows, formatForm.headerRowCount])

  const headerOptions = useMemo(() => {
    if (!formatHeaders.length) return []
    return formatHeaders.map((header, index) => ({
      value: header,
      label: header || `列${index + 1}`,
    }))
  }, [formatHeaders])

  const resetMappingFields = () => {
    setFormatForm((prev) => ({
      ...prev,
      dateColumn: '',
      dateFormats: '',
      signedAmountColumn: '',
      depositColumn: '',
      withdrawalColumn: '',
      descriptionColumn: '',
      balanceColumn: '',
    }))
  }

  const resetFormatInputs = () => {
    setFormatFile(null)
    setFormatFileName('')
    setFormatRows([])
    setFormatHeaders([])
    resetMappingFields()
  }

  const readFileWithEncoding = async (
    file: File,
    encoding: 'shift-jis' | 'utf-8'
  ) => {
    const buffer = await file.arrayBuffer()
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch {
      return new TextDecoder('utf-8').decode(buffer)
    }
  }

  const buildHeaders = (rows: string[][], headerCount: number) => {
    if (!rows.length) return []
    if (headerCount > 0) {
      const headerIndex = Math.min(rows.length - 1, headerCount - 1)
      return rows[headerIndex] ?? []
    }
    const maxCols = Math.max(...rows.map((row) => row.length))
    return Array.from({ length: maxCols }, (_, idx) => `列${idx + 1}`)
  }

  const handleFileChange = async (file: File | null) => {
    if (!file) return
    setFormatFile(file)
    const text = await readFileWithEncoding(file, formatEncoding)
    const rows = parseCsv(text).slice(0, 80)
    setFormatRows(rows)
    setFormatFileName(file.name)
    if (!rows.length) {
      setFormatHeaders([])
      return
    }
    const headerCount = Math.max(0, Number(formatForm.headerRowCount || 0))
    const headers = buildHeaders(rows, headerCount)
    setFormatHeaders(headers)
    resetMappingFields()
  }

  useEffect(() => {
    if (!formatFile) return
    void (async () => {
      const text = await readFileWithEncoding(formatFile, formatEncoding)
      const rows = parseCsv(text).slice(0, 80)
      setFormatRows(rows)
      if (!rows.length) {
        setFormatHeaders([])
        return
      }
      const headerCount = Math.max(0, Number(formatForm.headerRowCount || 0))
      const headers = buildHeaders(rows, headerCount)
      setFormatHeaders(headers)
      resetMappingFields()
    })()
  }, [formatEncoding, formatFile, formatForm.headerRowCount])

  const saveTemplateMutation = useMutation<{ created?: number }, Error, FormData>({
    mutationFn: async (formData: FormData) => {
      const res = await authFetcher(
        `/api/ledger/accounts/${account.accountId}/csv-templates/`,
        {
          method: 'POST',
          body: formData,
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'CSVフォーマットの保存に失敗しました。')
      }
      return data
    },
    onMutate: () => {
      setFormatStatus('loading')
      setFormatMessage('')
    },
    onSuccess: async (data) => {
      setIsFormatView(true)
      setFormatStatus('success')
      const createdCount = Number(data.created ?? 0)
      if (registerRecordsOnSave) {
        setFormatMessage(`CSVフォーマットを保存し、${createdCount}件を登録しました。`)
      } else {
        setFormatMessage('CSVフォーマットを保存しました。')
      }
      await onSaved()
    },
    onError: (error) => {
      setFormatStatus('error')
      setFormatMessage(error.message || 'CSVフォーマットの保存に失敗しました。')
    },
  })

  const applyTemplateToForm = useCallback((payload: {
    name?: string
    hasHeader?: boolean
    headerRowIndex?: number
    dateFormats?: string[]
    encoding?: string
    amountRule?: string
    signedAmountColumn?: string
    depositColumn?: string
    withdrawalColumn?: string
    dateColumn?: string
    descriptionColumn?: string
    balanceColumn?: string
  }) => {
    if (payload.encoding === 'utf-8') setFormatEncoding('utf-8')
    else if (payload.encoding === 'cp932') setFormatEncoding('shift-jis')
    setFormatForm((prev) => ({
      ...prev,
      name: payload.name ?? prev.name,
      headerRowCount: String(
        payload.hasHeader === false
          ? 0
          : typeof payload.headerRowIndex === 'number'
            ? payload.headerRowIndex + 1
            : Number(prev.headerRowCount || 0)
      ),
      dateFormats: Array.isArray(payload.dateFormats)
        ? payload.dateFormats.join(', ')
        : prev.dateFormats,
      amountRule: payload.amountRule ?? prev.amountRule,
      signedAmountColumn: payload.signedAmountColumn ?? prev.signedAmountColumn,
      depositColumn: payload.depositColumn ?? prev.depositColumn,
      withdrawalColumn: payload.withdrawalColumn ?? prev.withdrawalColumn,
      dateColumn: payload.dateColumn ?? prev.dateColumn,
      descriptionColumn: payload.descriptionColumn ?? prev.descriptionColumn,
      balanceColumn: payload.balanceColumn ?? prev.balanceColumn,
    }))
  }, [])

  useEffect(() => {
    if (!account.hasCsvTemplate) return
    void (async () => {
      try {
        const res = await authFetcher(
          `/api/ledger/accounts/${account.accountId}/csv-templates/`
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        applyTemplateToForm(data)
        setIsFormatView(true)
      } catch {
        // ignore load errors
      }
    })()
  }, [
    applyTemplateToForm,
    account.hasCsvTemplate,
    account.accountId,
  ])

  const effectiveAmountRule = isCreditCard ? 'usage' : formatForm.amountRule

  const handleFormatSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormatMessage('')

    if (!formatForm.name.trim()) {
      setFormatStatus('error')
      setFormatMessage('テンプレート名を入力してください。')
      return
    }

    if (!formatForm.dateColumn.trim()) {
      setFormatStatus('error')
      setFormatMessage(isCreditCard ? '利用日のカラム名を入力してください。' : '取引日のカラム名を入力してください。')
      return
    }

    if (
      (effectiveAmountRule === 'signed' || effectiveAmountRule === 'usage') &&
      !formatForm.signedAmountColumn.trim()
    ) {
      setFormatStatus('error')
      setFormatMessage(
        effectiveAmountRule === 'usage'
          ? '利用額のカラム名を入力してください。'
          : '符号付き金額のカラム名を入力してください。'
      )
      return
    }

    if (
      effectiveAmountRule === 'split' &&
      (!formatForm.depositColumn.trim() || !formatForm.withdrawalColumn.trim())
    ) {
      setFormatStatus('error')
      setFormatMessage('入金/出金のカラム名を入力してください。')
      return
    }

    if (registerRecordsOnSave && !formatFile) {
      setFormatStatus('error')
      setFormatMessage('CSVを同時登録する場合はCSVファイルを選択してください。')
      return
    }

    const headerCount = Math.max(0, Number(formatForm.headerRowCount || 0))
    const formData = new FormData()
    formData.append('name', formatForm.name.trim())
    formData.append('hasHeader', String(headerCount > 0))
    formData.append('headerRowIndex', String(headerCount > 0 ? headerCount - 1 : 0))
    formData.append('dateColumn', formatForm.dateColumn)
    formData.append(
      'dateFormats',
      formatForm.dateFormats
        ? formatForm.dateFormats
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .join(',')
        : ''
    )
    formData.append('amountRule', effectiveAmountRule)
    formData.append('signedAmountColumn', formatForm.signedAmountColumn)
    formData.append(
      'depositColumn',
      effectiveAmountRule === 'split' ? formatForm.depositColumn : ''
    )
    formData.append(
      'withdrawalColumn',
      effectiveAmountRule === 'split' ? formatForm.withdrawalColumn : ''
    )
    formData.append('descriptionColumn', formatForm.descriptionColumn)
    formData.append('balanceColumn', isCreditCard ? '' : formatForm.balanceColumn)
    formData.append('registerRecords', String(registerRecordsOnSave))
    formData.append('encoding', formatEncoding === 'shift-jis' ? 'cp932' : 'utf-8')
    if (registerRecordsOnSave && formatFile) {
      formData.append('file', formatFile)
    }

    saveTemplateMutation.mutate(formData)
  }


  return (
      <div className="rounded-[18px] border border-[#d7dee4] bg-white p-6 shadow-[0_18px_42px_rgba(16,38,49,0.12)]">
        {isCreditCard && (
          <div className="mb-4 rounded-[10px] border border-[#bfd7ed] bg-[#eef5fb] p-3 text-xs text-[#1c3f8a]">
            <p className="font-semibold">クレジットカード明細の取り込みヒント</p>
            <ul className="mt-1 list-inside list-disc">
              <li>必要なカラムは「利用日」「利用額」のみ（必要なら「利用店名」も）</li>
              <li>残高や入金/出金カラムは不要（CSV に存在しても無視されます）</li>
              <li>利用額は自動的に出金として扱われ、当月利用額に反映されます</li>
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#0f1c22]">CSVフォーマット登録</p>
            <p className="text-xs text-[#7a8790]">
              ファイルを読み込んでカラムを設定します。
            </p>
          </div>
            {account.hasCsvTemplate && isFormatView && (
            <button
              type="button"
              onClick={() => {
                setIsFormatView(false)
                resetFormatInputs()
              }}
              className="rounded-full border border-[#d7dee4] bg-white px-3 py-1.5 text-xs font-bold text-[#0f1c22] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(16,38,49,0.12)]"
            >
              再設定する
            </button>
          )}
        </div>

        <form onSubmit={handleFormatSubmit} className="mt-4 grid gap-4">
        {isFormatView && (
            <div className="rounded-[12px] border border-[#e3e9ee] bg-white p-4">
              <p className="text-sm font-semibold text-[#0f1c22]">登録済みフォーマット</p>
              <div className="mt-3 grid gap-3 text-sm text-[#0f1c22] md:grid-cols-2">
                <div>
                  <span className="text-xs text-[#7a8790]">テンプレート名</span>
                  <p className="font-semibold">{formatForm.name || '未設定'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7a8790]">ヘッダー行数</span>
                  <p className="font-semibold">{formatForm.headerRowCount || '0'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7a8790]">文字コード</span>
                  <p className="font-semibold">
                    {formatEncoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-[#7a8790]">取引日カラム</span>
                  <p className="font-semibold">{formatForm.dateColumn || '未設定'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7a8790]">日付フォーマット</span>
                  <p className="font-semibold">{formatForm.dateFormats || '未設定'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7a8790]">取引内容カラム</span>
                  <p className="font-semibold">
                    {formatForm.descriptionColumn || '未設定'}
                  </p>
                </div>
                {!isCreditCard && (
                  <div>
                    <span className="text-xs text-[#7a8790]">残高カラム</span>
                    <p className="font-semibold">{formatForm.balanceColumn || '未設定'}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs text-[#7a8790]">金額の扱い</span>
                  <p className="font-semibold">
                    {effectiveAmountRule === 'usage'
                      ? '利用額（カード明細）'
                      : effectiveAmountRule === 'signed'
                        ? '符号付き金額'
                        : '入金/出金カラム分離'}
                  </p>
                </div>
                {effectiveAmountRule === 'usage' ? (
                  <div>
                    <span className="text-xs text-[#7a8790]">利用額カラム</span>
                    <p className="font-semibold">
                      {formatForm.signedAmountColumn || '未設定'}
                    </p>
                  </div>
                ) : effectiveAmountRule === 'signed' ? (
                  <div>
                    <span className="text-xs text-[#7a8790]">符号付き金額カラム</span>
                    <p className="font-semibold">
                      {formatForm.signedAmountColumn || '未設定'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="text-xs text-[#7a8790]">入金カラム</span>
                      <p className="font-semibold">
                        {formatForm.depositColumn || '未設定'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-[#7a8790]">出金カラム</span>
                      <p className="font-semibold">
                        {formatForm.withdrawalColumn || '未設定'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {!isFormatView && (
            <div className="rounded-[12px] border border-dashed border-[#d7dee4] bg-[#f8fafb] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0f1c22]">CSVファイルを読み込む</p>
                <p className="text-xs text-[#7a8790]">
                  プレビューからカラムを選択できます。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold text-[#0f1c22]">文字コード</label>
                <select
                  value={formatEncoding}
                  onChange={(event) =>
                    setFormatEncoding(event.target.value as 'shift-jis' | 'utf-8')
                  }
                  disabled={isFormatView}
                  className="rounded-full border border-[#d7dee4] bg-white px-3 py-1.5 text-xs font-bold text-[#0f1c22]"
                >
                  <option value="shift-jis">Shift_JIS</option>
                  <option value="utf-8">utf-8</option>
                </select>
                <label className="flex items-center gap-2 rounded-full border border-[#d7dee4] bg-white px-3 py-1.5 text-xs font-bold text-[#0f1c22]">
                  CSVを選択
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) =>
                      void handleFileChange(event.target.files?.[0] ?? null)
                    }
                    disabled={isFormatView}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
            {formatFileName && (
              <p className="mt-2 text-xs text-[#5d6a72]">{formatFileName}</p>
            )}
            </div>
          )}

          {!isFormatView && (
            <div className="rounded-[12px] border border-[#e3e9ee] bg-white p-4">
              <p className="text-sm font-semibold text-[#0f1c22]">ヘッダー設定</p>
              <p className="text-xs text-[#7a8790]">
                ヘッダー行数を指定するとプレビューとカラム候補が更新されます。
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>テンプレート名</span>
                  <input
                    type="text"
                    value={formatForm.name}
                    onChange={(event) =>
                      setFormatForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="例: 銀行明細 (Web明細)"
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>ヘッダー行数 (0なら列番号指定)</span>
                  <input
                    type="number"
                    min="0"
                    value={formatForm.headerRowCount}
                    onChange={(event) => {
                      const next = event.target.value
                      setFormatForm((prev) => ({ ...prev, headerRowCount: next }))
                      if (formatRows.length > 0) {
                        const count = Math.max(0, Number(next || 0))
                        const headers = buildHeaders(formatRows, count)
                        setFormatHeaders(headers)
                        resetMappingFields()
                      }
                    }}
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
              </div>
            </div>
          )}

          {!isFormatView && formatHeaders.length > 0 && (
            <div className="rounded-[12px] border border-[#e3e9ee] bg-white p-4">
              <p className="text-sm font-semibold text-[#0f1c22]">カラムの割り当て</p>
              <p className="text-xs text-[#7a8790]">
                {isCreditCard
                  ? '必須項目: 利用日 / 利用額'
                  : `必須項目: 取引日 / 入出金${isBankAccount ? ' / 残高' : ''}`}
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>取引日カラム</span>
                  <select
                    value={formatForm.dateColumn}
                    onChange={(event) =>
                      setFormatForm((prev) => ({
                        ...prev,
                        dateColumn: event.target.value,
                      }))
                    }
                    disabled={isFormatView}
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  >
                    <option value="">選択してください</option>
                    {headerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>日付フォーマット</span>
                  <input
                    type="text"
                    value={formatForm.dateFormats}
                    onChange={(event) =>
                      setFormatForm((prev) => ({
                        ...prev,
                        dateFormats: event.target.value,
                      }))
                    }
                    placeholder="例: %Y/%m/%d,%Y-%m-%d"
                    disabled={isFormatView}
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>取引内容カラム</span>
                  <select
                    value={formatForm.descriptionColumn}
                    onChange={(event) =>
                      setFormatForm((prev) => ({
                        ...prev,
                        descriptionColumn: event.target.value,
                      }))
                    }
                    disabled={isFormatView}
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  >
                    <option value="">未設定</option>
                    {headerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {isCreditCard ? (
                <div className="mt-4">
                  <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                    <span>利用額カラム</span>
                    <select
                      value={formatForm.signedAmountColumn}
                      onChange={(event) =>
                        setFormatForm((prev) => ({
                          ...prev,
                          signedAmountColumn: event.target.value,
                        }))
                      }
                      disabled={isFormatView}
                      className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                    >
                      <option value="">選択してください</option>
                      {headerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-xs text-[#7a8790]">
                    明細上の利用額カラムを指定してください。値は自動的に「出金」として保存されます。
                  </p>
                </div>
              ) : (
                <>
                  <div className="mt-4">
                    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                      <span>残高カラム</span>
                      <select
                        value={formatForm.balanceColumn}
                        onChange={(event) =>
                          setFormatForm((prev) => ({
                            ...prev,
                            balanceColumn: event.target.value,
                          }))
                        }
                        disabled={isFormatView}
                        className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                      >
                        <option value="">未設定</option>
                        {headerOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4">
                    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                      <span>入出金の判定方法</span>
                      <select
                        value={formatForm.amountRule}
                        onChange={(event) =>
                          setFormatForm((prev) => ({
                            ...prev,
                            amountRule: event.target.value,
                          }))
                        }
                        disabled={isFormatView}
                        className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                      >
                        <option value="signed">符号付き金額</option>
                        <option value="split">入金/出金カラム分離</option>
                      </select>
                    </label>
                  </div>

                  {formatForm.amountRule === 'signed' && (
                    <div className="mt-4">
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                        <span>符号付き金額カラム</span>
                        <select
                          value={formatForm.signedAmountColumn}
                          onChange={(event) =>
                            setFormatForm((prev) => ({
                              ...prev,
                              signedAmountColumn: event.target.value,
                            }))
                          }
                          disabled={isFormatView}
                          className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                        >
                          <option value="">選択してください</option>
                          {headerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  {formatForm.amountRule === 'split' && (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                        <span>入金カラム</span>
                        <select
                          value={formatForm.depositColumn}
                          onChange={(event) =>
                            setFormatForm((prev) => ({
                              ...prev,
                              depositColumn: event.target.value,
                            }))
                          }
                          disabled={isFormatView}
                          className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                        >
                          <option value="">選択してください</option>
                          {headerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                        <span>出金カラム</span>
                        <select
                          value={formatForm.withdrawalColumn}
                          onChange={(event) =>
                            setFormatForm((prev) => ({
                              ...prev,
                              withdrawalColumn: event.target.value,
                            }))
                          }
                          disabled={isFormatView}
                          className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                        >
                          <option value="">選択してください</option>
                          {headerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </>
              )}

            </div>
          )}

          {!isFormatView && previewRows.length > 0 && (
            <div className="rounded-[12px] border border-[#e3e9ee] bg-white p-4">
              <p className="text-sm font-semibold text-[#0f1c22]">プレビュー</p>
              <div className="mt-3 max-h-[320px] overflow-auto">
                <table className="min-w-full text-left text-xs text-[#0f1c22]">
                  <thead className="bg-[#f7f9fb] text-[0.7rem] uppercase text-[#5d6a72]">
                    <tr>
                      {formatHeaders.map((header, index) => (
                        <th key={header || `header-${index}`} className="px-3 py-2">
                          {header || `列${index + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`} className="border-b border-[#e3e9ee]">
                        {formatHeaders.map((_, colIndex) => (
                          <td
                            key={`cell-${rowIndex}-${colIndex}`}
                            className="px-3 py-2 text-[#0f1c22]"
                          >
                            {row[colIndex] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isFormatView && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#0f1c22]">
                <input
                  type="checkbox"
                  checked={registerRecordsOnSave}
                  onChange={(event) => setRegisterRecordsOnSave(event.target.checked)}
                  className="h-4 w-4 rounded border-[#9bb3bf] text-[#1a7b6d] focus:ring-[#1a7b6d]"
                />
                フォーマット保存時にCSVを同時登録する
              </label>
              <button
                type="submit"
                disabled={formatStatus === 'loading'}
                className="ml-auto rounded-full border border-[#1a7b6d] bg-[#1a7b6d] px-4 py-2 text-xs font-bold text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)]"
              >
                {formatStatus === 'loading' ? '保存中...' : 'フォーマットを保存'}
              </button>
            </div>
          )}

          {formatMessage && formatStatus !== 'idle' && (
            <div
              className={`rounded-[10px] px-4 py-3 text-sm ${
                formatStatus === 'success'
                  ? 'border border-[#86d19b] bg-[#e6f4ec] text-[#0e4f2c]'
                  : 'border border-[#f28b82] bg-[#fff1f0] text-[#7f1d1d]'
              }`}
            >
              {formatMessage}
            </div>
          )}
        </form>
      </div>
  )
}

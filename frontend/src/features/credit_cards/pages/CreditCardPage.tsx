import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'

import { authFetcher } from '../../../api/client'
import { buttonClasses } from '../../../ui/button'
import AccountCreatePanel from '../../assets/components/AccountCreatePanel'
import AccountDetail from '../../assets/components/AccountDetail'
import AssetSection from '../../assets/components/AssetSection'
import ImportTab from '../../assets/components/ImportTab'
import MonthPicker from '../../shared/components/MonthPicker'
import { useMonth } from '../../shared/state/MonthContext'
import type {
  AccountTransaction,
  AssetAccount,
  AssetKind,
  BalanceResult,
  CreateAccountResult,
  DeleteAccountResult,
  UploadResult,
} from '../../assets/types/types'

const getShowAmounts = (): boolean => {
  try {
    const stored = localStorage.getItem('showAmounts')
    if (stored === null) return true
    return stored === 'true'
  } catch {
    return true
  }
}

const yenFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const formatYen = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return '¥-'
  const num = typeof value === 'string' ? Number(value.toString().replace(/,/g, '')) : value
  if (Number.isNaN(num)) return '¥-'
  return yenFormatter.format(num)
}

export default function CreditCardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = useMemo(() => new Date(), [])
  const [showAmounts, setShowAmounts] = useState<boolean>(() => getShowAmounts())
  const {
    monthLabel: selectedMonth,
    year: monthPickerYear,
    month: monthPickerMonthValue,
    setYearMonth,
  } = useMonth()

  const handleMonthChange = (year: number, month: number) => {
    setYearMonth(year, month)
  }

  const [file, setFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [uploadMessage, setUploadMessage] = useState('')
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [createMessage, setCreateMessage] = useState('')
  const [createForm, setCreateForm] = useState({
    assetKind: 'credit_card' as AssetKind,
    name: '',
    branchName: '',
    accountNumber: '',
    issuer: '',
    last4: '',
    closingDay: '',
    paymentDay: '',
    paymentDestinationId: '',
  })

  const parseJsonSafely = async (res: Response) => {
    try {
      return await res.json()
    } catch {
      throw new Error(`サーバーエラー (status: ${res.status})`)
    }
  }

  const balanceQuery = useQuery<BalanceResult, Error>({
    queryKey: ['balance', selectedMonth],
    queryFn: async () => {
      const res = await authFetcher(`/api/ledger/assets/?month=${selectedMonth}`)
      const data: BalanceResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || '資産取得に失敗しました。')
      }
      return data
    },
    staleTime: 0,
  })

  const balanceResult = balanceQuery.data ?? null
  const balanceMessage = balanceQuery.error?.message ?? ''
  const refetchBalance = balanceQuery.refetch

  const creditCards = useMemo<AssetAccount[]>(
    () => balanceResult?.creditCards ?? [],
    [balanceResult?.creditCards]
  )
  const bankAccounts = useMemo<AssetAccount[]>(
    () => balanceResult?.bankAccounts ?? [],
    [balanceResult?.bankAccounts]
  )

  const accountParam = searchParams.get('account')
  const assetKindParam = searchParams.get('assetKind') as AssetKind | null
  const detailAccount = useMemo(() => {
    if (!accountParam || !assetKindParam) return null
    if (assetKindParam !== 'credit_card') return null
    return creditCards.find((acc) => String(acc.accountId) === accountParam) ?? null
  }, [accountParam, assetKindParam, creditCards])

  const {
    data: transactionData,
    status: transactionQueryStatus,
    error: transactionQueryError,
    refetch: refetchTransactions,
  } = useQuery<AccountTransaction[], Error>({
    queryKey: ['transactions', 'credit_card', detailAccount?.accountId ?? '', selectedMonth],
    queryFn: async ({ queryKey }) => {
      const accountId = queryKey[2]
      if (!accountId) throw new Error('取引取得に失敗しました。')
      const res = await authFetcher(
        `/api/ledger/accounts/${String(accountId)}/transactions/?limit=200&month=${selectedMonth}`
      )
      const data = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || '取引取得に失敗しました。')
      }
      return data.transactions ?? []
    },
    enabled: Boolean(detailAccount),
    staleTime: 0,
  })

  const transactionStatus =
    transactionQueryStatus === 'pending'
      ? 'loading'
      : transactionQueryStatus === 'error'
        ? 'error'
        : transactionQueryStatus === 'success'
          ? 'success'
          : 'idle'
  const transactionMessage = transactionQueryError?.message ?? ''
  const transactions = transactionData ?? []

  const displayAmount = (value: number | string | null | undefined) =>
    showAmounts ? formatYen(value) : '******'

  const formatDelta = (value: number | string | null | undefined) => {
    if (!showAmounts) return '******'
    if (value === null || value === undefined) return '¥-'
    const num = typeof value === 'string' ? Number(value.toString().replace(/,/g, '')) : value
    if (Number.isNaN(num)) return '¥-'
    const sign = num > 0 ? '+' : num < 0 ? '-' : ''
    return `${sign}${displayAmount(Math.abs(num))}`
  }

  const statusClassName = (status: 'loading' | 'success' | 'error') => {
    if (status === 'success') return 'border border-[#86d19b] bg-[#e6f4ec] text-[#0e4f2c]'
    if (status === 'error') return 'border border-[#f28b82] bg-[#fff1f0] text-[#7f1d1d]'
    return 'border border-[#9bb6ff] bg-[#eef4ff] text-[#1c3f8a]'
  }

  const openCreateForm = () => {
    setCreateForm({
      assetKind: 'credit_card',
      name: '',
      branchName: '',
      accountNumber: '',
      issuer: '',
      last4: '',
      closingDay: '',
      paymentDay: '',
      paymentDestinationId: '',
    })
    setCreateFormOpen(true)
  }

  const handleCreateAccountSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setCreateStatus('loading')
    setCreateMessage('')
    if (!createForm.name.trim()) {
      setCreateStatus('error')
      setCreateMessage('名前を入力してください。')
      return
    }
    try {
      const body: Record<string, unknown> = {
        assetKind: 'credit_card',
        name: createForm.name.trim(),
        issuer: createForm.issuer.trim(),
        last4: createForm.last4.trim(),
      }
      if (createForm.closingDay) body.closing_day = Number(createForm.closingDay)
      if (createForm.paymentDay) body.payment_day = Number(createForm.paymentDay)
      if (createForm.paymentDestinationId)
        body.payment_destination_id = Number(createForm.paymentDestinationId)

      const res = await authFetcher('/api/ledger/accounts/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data: CreateAccountResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || 'カードの作成に失敗しました。')
      }
      setCreateStatus('success')
      setCreateMessage('カードを作成しました。')
      setCreateFormOpen(false)
      await refetchBalance()
    } catch (err) {
      setCreateStatus('error')
      setCreateMessage(err instanceof Error ? err.message : 'カードの作成に失敗しました。')
    }
  }

  const requestAccountDelete = async (account: AssetAccount) => {
    const endpoint = `/api/ledger/accounts/${account.accountId}/?assetKind=${account.assetKind}`
    const res = await authFetcher(endpoint, { method: 'DELETE' })
    const data: DeleteAccountResult = await parseJsonSafely(res)
    if (!res.ok) {
      throw new Error(data.error || 'カードの削除に失敗しました。')
    }
  }

  const deleteAccountMutation = useMutation<void, Error, AssetAccount>({
    mutationFn: async (account: AssetAccount) => {
      await requestAccountDelete(account)
    },
  })
  const resetDeleteAccountMutation = deleteAccountMutation.reset
  const deleteStatus =
    deleteAccountMutation.status === 'pending'
      ? 'loading'
      : deleteAccountMutation.status === 'error'
        ? 'error'
        : 'idle'
  const deleteMessage = deleteAccountMutation.error?.message ?? ''

  const handleDeleteAccount = async (account: AssetAccount) => {
    if (!window.confirm(`カード「${account.accountName}」を削除します。よろしいですか？`)) return
    await deleteAccountMutation.mutateAsync(account)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('account')
    nextParams.delete('assetKind')
    setSearchParams(nextParams)
    await refetchBalance()
  }

  useEffect(() => {
    if (!detailAccount) return
    resetDeleteAccountMutation()
  }, [detailAccount, resetDeleteAccountMutation])

  const handleCsvUploadSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!detailAccount) return
    if (!file) {
      setUploadMessage('CSVファイルを選択してください。')
      setUploadStatus('error')
      return
    }
    setUploadStatus('loading')
    setUploadMessage('')
    const formData = new FormData()
    formData.append('file', file)
    // encoding はテンプレート登録時に保存された値がバックエンドで使われる
    formData.append('accountId', String(detailAccount.accountId))
    try {
      const res = await authFetcher('/api/ledger/accounts/upload-csv/', {
        method: 'POST',
        body: formData,
      })
      const data: UploadResult = await parseJsonSafely(res)
      if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました。')
      setUploadStatus('success')
      setUploadMessage(`登録件数: ${data.created ?? 0}`)
      setFile(null)
      await refetchTransactions()
      await refetchBalance()
    } catch (err) {
      setUploadStatus('error')
      setUploadMessage(err instanceof Error ? err.message : 'アップロードに失敗しました。')
    }
  }

  const handleFormatSaved = async () => {
    await Promise.allSettled([refetchBalance(), refetchTransactions()])
  }

  const balanceStatus =
    balanceQuery.status === 'pending'
      ? 'loading'
      : balanceQuery.status === 'error'
        ? 'error'
        : 'success'
  const outstandingTotal = balanceResult?.creditCardsTotal ?? null
  const outstandingChange = balanceResult?.creditCardsTotalChange ?? null

  return (
    <>
      <section className="flex min-h-[360px] w-full flex-col gap-5 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <p className="text-[1rem] font-semibold text-[#0d2b32]">
              {detailAccount ? detailAccount.accountName : 'クレジットカード利用額'}
            </p>
            <div className="flex items-center justify-start gap-3 md:justify-center">
              <MonthPicker
                year={monthPickerYear}
                month={monthPickerMonthValue}
                today={today}
                onChange={handleMonthChange}
                menuAlign="center"
              />
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              {detailAccount && (
                <button
                  type="button"
                  onClick={() => {
                    const nextParams = new URLSearchParams(searchParams)
                    nextParams.delete('account')
                    nextParams.delete('assetKind')
                    setSearchParams(nextParams)
                  }}
                  className={buttonClasses({
                    variant: 'primary',
                    size: 'lg',
                    shape: 'rounded',
                    className: 'w-[140px] text-sm font-bold',
                  })}
                >
                  一覧に戻る
                </button>
              )}
              <button
                type="button"
                className={buttonClasses({
                  variant: 'primary',
                  size: 'lg',
                  shape: 'rounded',
                  className: 'w-[140px] text-sm font-bold',
                })}
                onClick={() =>
                  setShowAmounts((prev) => {
                    const next = !prev
                    try {
                      localStorage.setItem('showAmounts', String(next))
                    } catch {
                      // ignore
                    }
                    return next
                  })
                }
              >
                {showAmounts ? '金額を非表示' : '金額を表示'}
              </button>
            </div>
          </div>
          <p className="text-[2rem] font-extrabold text-[#b23b3b]">
            {displayAmount(detailAccount ? detailAccount.balance : outstandingTotal)}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#5d6a72]">
            <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 font-semibold text-[#0f1c22]">
              先月比 {formatDelta(detailAccount ? detailAccount.balanceChange : outstandingChange)}
            </span>
          </div>
        </div>

        {balanceStatus === 'error' && balanceMessage && (
          <div className={`mt-2 rounded-[10px] px-4 py-3 text-sm ${statusClassName('error')}`}>
            {balanceMessage}
          </div>
        )}

        {balanceStatus === 'success' && balanceResult && (
          <>
            {detailAccount ? (
              <AccountDetail
                key={`credit_card:${detailAccount.accountId}`}
                selectedAccount={detailAccount}
                selectedMonth={selectedMonth}
                displayAmount={displayAmount}
                importPanel={
                  detailAccount.hasCsvTemplate ? (
                    <ImportTab
                      uploadStatus={uploadStatus}
                      uploadMessage={uploadMessage}
                      fileName={file?.name ?? ''}
                      onFileChange={setFile}
                      onSubmit={handleCsvUploadSubmit}
                      statusClassName={statusClassName}
                    />
                  ) : null
                }
                transactionStatus={transactionStatus}
                transactionMessage={transactionMessage}
                transactions={transactions}
                onDeleteAccount={handleDeleteAccount}
                onFormatSaved={handleFormatSaved}
                deleteStatus={deleteStatus}
                deleteMessage={deleteMessage}
                statusClassName={statusClassName}
              />
            ) : (
              <div className="grid gap-4">
                <AssetSection
                  title="クレジットカード"
                  accounts={creditCards}
                  addLabel="カードを追加"
                  emptyText="クレジットカードがまだ登録されていません。"
                  displayAmount={displayAmount}
                  onSelectAccount={(account) => {
                    const nextParams = new URLSearchParams(searchParams)
                    nextParams.set('account', String(account.accountId))
                    nextParams.set('assetKind', account.assetKind)
                    setSearchParams(nextParams)
                  }}
                  onAddAccount={openCreateForm}
                  showHeader={false}
                />
              </div>
            )}
          </>
        )}

        {balanceStatus === 'loading' && (
          <div className={`mt-2 rounded-[10px] px-4 py-3 text-sm ${statusClassName('loading')}`}>
            読み込み中...
          </div>
        )}
      </section>

      <AccountCreatePanel
        isOpen={createFormOpen}
        onToggle={() => setCreateFormOpen((prev) => !prev)}
        onSubmit={handleCreateAccountSubmit}
        status={createStatus}
        message={createMessage}
        assetKind={createForm.assetKind}
        name={createForm.name}
        branchName={createForm.branchName}
        accountNumber={createForm.accountNumber}
        issuer={createForm.issuer}
        last4={createForm.last4}
        closingDay={createForm.closingDay}
        paymentDay={createForm.paymentDay}
        paymentDestinationId={createForm.paymentDestinationId}
        bankAccountOptions={bankAccounts}
        onNameChange={(value) => setCreateForm((p) => ({ ...p, name: value }))}
        onBranchNameChange={(value) => setCreateForm((p) => ({ ...p, branchName: value }))}
        onAccountNumberChange={(value) => setCreateForm((p) => ({ ...p, accountNumber: value }))}
        onIssuerChange={(value) => setCreateForm((p) => ({ ...p, issuer: value }))}
        onLast4Change={(value) => setCreateForm((p) => ({ ...p, last4: value }))}
        onClosingDayChange={(value) => setCreateForm((p) => ({ ...p, closingDay: value }))}
        onPaymentDayChange={(value) => setCreateForm((p) => ({ ...p, paymentDay: value }))}
        onPaymentDestinationIdChange={(value) =>
          setCreateForm((p) => ({ ...p, paymentDestinationId: value }))
        }
        statusClassName={statusClassName}
      />
    </>
  )
}

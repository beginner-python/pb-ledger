import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, type QueryStatus } from '@tanstack/react-query'

import { authFetcher } from '../../../api/client'
import BalanceTab from '../components/BalanceTab'
import AccountCreatePanel from '../components/AccountCreatePanel'
import ImportTab from '../components/ImportTab'
import SnapshotTab from '../components/SnapshotTab'
import SnapshotHistory from '../components/SnapshotHistory'
import { useMonth } from '../../shared/state/MonthContext'
import { todayString } from '../../shared/utils/date'
import type {
  AccountTransaction,
  AssetKind,
  AssetAccount,
  BalanceResult,
  CreateAccountResult,
  DeleteAccountResult,
  MonthlySummaryAccount,
  MonthlySummaryResult,
  SelectedAccount,
  SnapshotResult,
  UploadResult,
} from '../types/types'

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

const mapQueryStatusToState = (status: QueryStatus): 'idle' | 'loading' | 'success' | 'error' => {
  if (status === 'pending') return 'loading'
  if (status === 'error') return 'error'
  if (status === 'success') return 'success'
  return 'idle'
}

export default function BalancePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = useMemo(() => new Date(), [])
  const [showAmounts, setShowAmounts] = useState<boolean>(() => getShowAmounts())
  const {
    monthLabel: selectedMonth,
    year: monthPickerYear,
    month: monthPickerMonth,
    setYearMonth,
  } = useMonth()
  const [file, setFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [uploadMessage, setUploadMessage] = useState<string>('')
  const [snapshotStatus, setSnapshotStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [snapshotMessage, setSnapshotMessage] = useState<string>('')
  const [snapshotAccount, setSnapshotAccount] = useState<SelectedAccount | null>(null)
  const [snapshotDate, setSnapshotDate] = useState<string>(() => todayString())
  const [snapshotBalance, setSnapshotBalance] = useState<string>('')
  const [snapshotNotes, setSnapshotNotes] = useState<string>('')
  const [detailResetKey, setDetailResetKey] = useState<number>(0)
  const [createFormOpen, setCreateFormOpen] = useState<boolean>(false)
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [createMessage, setCreateMessage] = useState<string>('')
  const [createForm, setCreateForm] = useState({
    assetKind: 'bank_account' as AssetKind,
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

  const balanceStatus = mapQueryStatusToState(balanceQuery.status)
  const balanceMessage = balanceQuery.error?.message ?? ''
  const balanceResult = balanceQuery.data ?? null
  const refetchBalance = balanceQuery.refetch

  const monthlySummaryQuery = useQuery<MonthlySummaryResult, Error>({
    queryKey: ['monthly-summary', selectedMonth],
    queryFn: async () => {
      const res = await authFetcher(`/api/ledger/monthly-summary/?month=${selectedMonth}`)
      const data: MonthlySummaryResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || '今月の収入・支出の取得に失敗しました。')
      }
      return data
    },
    staleTime: 0,
  })

  const monthlyStatus = mapQueryStatusToState(monthlySummaryQuery.status)
  const monthlyMessage = monthlySummaryQuery.error?.message ?? ''
  const monthlySummary = monthlySummaryQuery.data ?? null
  const refetchMonthlySummary = monthlySummaryQuery.refetch

  const bankAccounts = useMemo<AssetAccount[]>(() => {
    return balanceResult?.bankAccounts ?? []
  }, [balanceResult?.bankAccounts])

  const cashWallets = useMemo<AssetAccount[]>(() => {
    return balanceResult?.cashWallets ?? []
  }, [balanceResult?.cashWallets])

  const financialAssets = useMemo<AssetAccount[]>(() => {
    return balanceResult?.financialAssets ?? []
  }, [balanceResult?.financialAssets])

  // クレカは別ページで扱うため allAssets には含めない
  const allAssets = useMemo<AssetAccount[]>(() => {
    return [...bankAccounts, ...cashWallets, ...financialAssets]
  }, [bankAccounts, cashWallets, financialAssets])

  const accountParam = searchParams.get('account')
  const assetKindParam = searchParams.get('assetKind') as AssetKind | null
  const detailAccount = useMemo(() => {
    if (!accountParam || !assetKindParam) return null
    return (
      allAssets.find(
        (acc) =>
          String(acc.accountId) === accountParam &&
          acc.assetKind === assetKindParam
      ) ?? null
    )
  }, [accountParam, assetKindParam, allAssets])

  const {
    data: transactionData,
    status: transactionQueryStatus,
    error: transactionQueryError,
    refetch: refetchTransactions,
  } = useQuery<AccountTransaction[], Error>({
    queryKey: [
      'transactions',
      detailAccount?.assetKind ?? '',
      detailAccount?.accountId ?? '',
      selectedMonth,
    ],
    queryFn: async ({ queryKey }) => {
      const accountId = queryKey[2]
      if (!accountId) {
        throw new Error('取引取得に失敗しました。')
      }
      const endpoint = `/api/ledger/accounts/${String(accountId)}/transactions/?limit=200&month=${selectedMonth}`
      const res = await authFetcher(endpoint)
      const data = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || '取引取得に失敗しました。')
      }
      return data.transactions ?? []
    },
    enabled: Boolean(
      detailAccount &&
        (detailAccount.assetKind === 'bank_account' ||
          detailAccount.assetKind === 'credit_card')
    ),
    staleTime: 0,
  })

  const transactionStatus = mapQueryStatusToState(transactionQueryStatus)
  const transactionMessage = transactionQueryError?.message ?? ''
  const transactions = transactionData ?? []
  const selectedMonthlySummary: MonthlySummaryAccount | null = useMemo(() => {
    if (!detailAccount || detailAccount.assetKind !== 'bank_account' || !monthlySummary?.accounts) {
      return null
    }
    return (
      monthlySummary.accounts.find(
        (account) => String(account.accountId) === String(detailAccount.accountId)
      ) ?? null
    )
  }, [detailAccount, monthlySummary?.accounts])

  const handleMonthChange = (year: number, month: number) => {
    setYearMonth(year, month)
  }

  const openCreateForm = (assetKind: AssetKind) => {
    setCreateForm({
      assetKind,
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) {
      setUploadMessage('CSVファイルを選択してください。')
      setUploadStatus('error')
      return
    }

    setUploadStatus('loading')
    setUploadMessage('')

    if (!detailAccount) {
      setUploadMessage('取込先口座を選択してください。')
      setUploadStatus('error')
      return
    }

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
      if (!res.ok) {
        throw new Error(data.error || 'アップロードに失敗しました。')
      }
      setUploadStatus('success')
      setUploadMessage(`登録件数: ${data.created ?? 0}`)
      setFile(null)
      await refetchTransactions()
      await refetchBalance()
    } catch (err) {
      const error = err instanceof Error ? err.message : 'アップロードに失敗しました。'
      setUploadStatus('error')
      setUploadMessage(error)
    }
  }

  const handleSnapshotSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSnapshotStatus('loading')
    setSnapshotMessage('')

    if (!snapshotAccount) {
      setSnapshotStatus('error')
      setSnapshotMessage('口座を選択してください。')
      return
    }

    if (!snapshotDate) {
      setSnapshotStatus('error')
      setSnapshotMessage('日付を入力してください。')
      return
    }

    if (!snapshotBalance.trim()) {
      setSnapshotStatus('error')
      setSnapshotMessage(
        snapshotAccount.assetKind === 'financial_asset'
          ? '評価額を入力してください。'
          : '残高を入力してください。'
      )
      return
    }

    try {
      const snapshotEndpoint = '/api/ledger/snapshots/'
      const res = await authFetcher(snapshotEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetKind: snapshotAccount.assetKind,
          accountId: snapshotAccount.id,
          asOf: snapshotDate,
          balance: snapshotBalance,
          notes: snapshotNotes,
        }),
      })
      const data: SnapshotResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || 'スナップショット登録に失敗しました。')
      }
      setSnapshotStatus('success')
      setSnapshotMessage('スナップショットを登録しました。')
      setSnapshotAccount(detailAccount ? toSelectedAccount(detailAccount) : null)
      setSnapshotDate('')
      setSnapshotBalance('')
      setSnapshotNotes('')
      setDetailResetKey((current) => current + 1)
      await refetchBalance()
    } catch (err) {
      const error =
        err instanceof Error ? err.message : 'スナップショット登録に失敗しました。'
      setSnapshotStatus('error')
      setSnapshotMessage(error)
    }
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
        assetKind: createForm.assetKind,
        name: createForm.name.trim(),
      }
      if (createForm.assetKind === 'bank_account') {
        body.branchName = createForm.branchName.trim()
        body.accountNumber = createForm.accountNumber.trim()
      }
      if (createForm.assetKind === 'credit_card') {
        body.issuer = createForm.issuer.trim()
        body.last4 = createForm.last4.trim()
        if (createForm.closingDay) body.closing_day = Number(createForm.closingDay)
        if (createForm.paymentDay) body.payment_day = Number(createForm.paymentDay)
        if (createForm.paymentDestinationId)
          body.payment_destination_id = Number(createForm.paymentDestinationId)
      }

      const res = await authFetcher('/api/ledger/accounts/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data: CreateAccountResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || '資産作成に失敗しました。')
      }
      setCreateStatus('success')
      setCreateMessage('資産を作成しました。')
      setCreateForm({
        assetKind: createForm.assetKind,
        name: '',
        branchName: '',
        accountNumber: '',
        issuer: '',
        last4: '',
        closingDay: '',
        paymentDay: '',
        paymentDestinationId: '',
      })
      setCreateFormOpen(false)
      await refetchBalance()
    } catch (err) {
      const error = err instanceof Error ? err.message : '資産作成に失敗しました。'
      setCreateStatus('error')
      setCreateMessage(error)
    }
  }

  const requestAccountDelete = async (account: AssetAccount) => {
    const endpoint = `/api/ledger/accounts/${account.accountId}/?assetKind=${account.assetKind}`
    const res = await authFetcher(endpoint, { method: 'DELETE' })
    const data: DeleteAccountResult = await parseJsonSafely(res)

    if (!res.ok) {
      throw new Error(data.error || '資産削除に失敗しました。')
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
    const initialConfirm = window.confirm(
      `資産「${account.accountName}」を削除します。よろしいですか？`
    )
    if (!initialConfirm) return

    await deleteAccountMutation.mutateAsync(account)

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('account')
    nextParams.delete('assetKind')
    setSearchParams(nextParams)
    setSnapshotAccount(null)
    await Promise.all([refetchBalance(), refetchMonthlySummary()])
  }

  const handleFormatSaved = async () => {
    await Promise.allSettled([
      refetchBalance(),
      refetchTransactions(),
      refetchMonthlySummary(),
    ])
  }

  const toSelectedAccount = (account: AssetAccount): SelectedAccount => ({
    id: String(account.accountId),
    assetKind: account.assetKind,
  })

  useEffect(() => {
    if (!detailAccount) return
    resetDeleteAccountMutation()
    setSnapshotAccount(toSelectedAccount(detailAccount))
  }, [detailAccount, resetDeleteAccountMutation])

  const displayAmount = (value: number | string | null | undefined) =>
    showAmounts ? formatYen(value) : '******'

  const statusClassName = (status: 'loading' | 'success' | 'error') => {
    if (status === 'success') {
      return 'border border-[#86d19b] bg-[#e6f4ec] text-[#0e4f2c]'
    }
    if (status === 'error') {
      return 'border border-[#f28b82] bg-[#fff1f0] text-[#7f1d1d]'
    }
    return 'border border-[#9bb6ff] bg-[#eef4ff] text-[#1c3f8a]'
  }

  return (
    <>
      <BalanceTab
        balanceStatus={balanceStatus}
        balanceMessage={balanceMessage}
        balanceResult={balanceResult}
        bankAccounts={bankAccounts}
        cashWallets={cashWallets}
        financialAssets={financialAssets}
      monthlyStatus={monthlyStatus}
      monthlyMessage={monthlyMessage}
      monthlySummary={monthlySummary}
      selectedMonthlySummary={selectedMonthlySummary}
      selectedMonth={selectedMonth}
      monthPickerYear={monthPickerYear}
      monthPickerMonth={monthPickerMonth}
      today={today}
      onMonthChange={handleMonthChange}
      displayAmount={displayAmount}
      showAmounts={showAmounts}
      onToggleShowAmounts={() =>
        setShowAmounts((prev) => {
          const next = !prev
          try {
            localStorage.setItem('showAmounts', String(next))
          } catch {
            // localStorageが使えない場合は無視
          }
          return next
        })
      }
      selectedAccount={detailAccount}
      detailResetKey={detailResetKey}
      onSelectAccount={(account) => {
        setSnapshotAccount(toSelectedAccount(account))
        const nextParams = new URLSearchParams(searchParams)
        nextParams.set('account', String(account.accountId))
        nextParams.set('assetKind', account.assetKind)
        setSearchParams(nextParams)
      }}
      onClearSelection={() => {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('account')
        nextParams.delete('assetKind')
        setSearchParams(nextParams)
      }}
      onAddAccount={openCreateForm}
      transactionStatus={transactionStatus}
      transactionMessage={transactionMessage}
      transactions={transactions}
      onDeleteAccount={handleDeleteAccount}
      onFormatSaved={handleFormatSaved}
      deleteStatus={deleteStatus}
      deleteMessage={deleteMessage}
      importPanel={
        (detailAccount?.assetKind === 'bank_account' ||
          detailAccount?.assetKind === 'credit_card') &&
        detailAccount?.hasCsvTemplate ? (
          <ImportTab
            uploadStatus={uploadStatus}
            uploadMessage={uploadMessage}
            fileName={file?.name ?? ''}
            onFileChange={setFile}
            onSubmit={handleSubmit}
            statusClassName={statusClassName}
          />
        ) : null
      }
      snapshotPanel={
        detailAccount ? (
          <SnapshotTab
            snapshotStatus={snapshotStatus}
            snapshotMessage={snapshotMessage}
            onSubmit={handleSnapshotSubmit}
            snapshotDate={snapshotDate}
            snapshotBalance={snapshotBalance}
            snapshotNotes={snapshotNotes}
            amountLabel={detailAccount.assetKind === 'financial_asset' ? '評価額' : '残高'}
            onSnapshotDateChange={setSnapshotDate}
            onSnapshotBalanceChange={setSnapshotBalance}
            onSnapshotNotesChange={setSnapshotNotes}
            statusClassName={statusClassName}
          />
        ) : null
      }
      snapshotHistoryPanel={
        detailAccount ? (
          <SnapshotHistory
            selectedAccount={detailAccount}
            displayAmount={displayAmount}
            onChanged={async () => {
              await Promise.allSettled([refetchBalance(), refetchMonthlySummary()])
            }}
            statusClassName={statusClassName}
          />
        ) : null
      }
      statusClassName={statusClassName}
      />
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
        onNameChange={(value) => setCreateForm((prev) => ({ ...prev, name: value }))}
        onBranchNameChange={(value) =>
          setCreateForm((prev) => ({ ...prev, branchName: value }))
        }
        onAccountNumberChange={(value) =>
          setCreateForm((prev) => ({ ...prev, accountNumber: value }))
        }
        onIssuerChange={(value) => setCreateForm((prev) => ({ ...prev, issuer: value }))}
        onLast4Change={(value) => setCreateForm((prev) => ({ ...prev, last4: value }))}
        onClosingDayChange={(value) =>
          setCreateForm((prev) => ({ ...prev, closingDay: value }))
        }
        onPaymentDayChange={(value) =>
          setCreateForm((prev) => ({ ...prev, paymentDay: value }))
        }
        onPaymentDestinationIdChange={(value) =>
          setCreateForm((prev) => ({ ...prev, paymentDestinationId: value }))
        }
        statusClassName={statusClassName}
      />
    </>
  )
}

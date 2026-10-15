import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AccountTransaction, AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'
import { fetchHouseholdCategories } from '../../household/services/household'
import CategoryTreeSelect from '../../household/components/CategoryTreeSelect'
import { resolveCategoryColor } from '../../household/utils/categoryColors'
import { buttonClasses } from '../../../ui/button'
import DropdownMenu from '../../shared/components/DropdownMenu'
import type { DropdownMenuItem } from '../../shared/components/DropdownMenu'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import CashHistoryPanel from './CashHistoryPanel'
import TxRowActions from './TxRowActions'
import TxTransferActions from './TxTransferActions'

type AccountDetailProps = {
  selectedAccount: AssetAccount
  selectedMonth: string
  displayAmount: (value: number | string | null | undefined) => string
  importPanel?: ReactNode
  snapshotPanel?: ReactNode
  snapshotHistoryPanel?: ReactNode
  transactionStatus: 'idle' | 'loading' | 'success' | 'error'
  transactionMessage: string
  transactions: AccountTransaction[]
  onDeleteAccount: (account: AssetAccount) => Promise<void>
  onFormatSaved: () => Promise<void>
  deleteStatus: 'idle' | 'loading' | 'error'
  deleteMessage: string
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

export default function AccountDetail({
  selectedAccount,
  selectedMonth,
  displayAmount,
  importPanel,
  snapshotPanel,
  snapshotHistoryPanel,
  transactionStatus,
  transactionMessage,
  transactions,
  onDeleteAccount,
  onFormatSaved,
  deleteStatus,
  deleteMessage,
  statusClassName,
}: AccountDetailProps) {
  const [detailPanel, setDetailPanel] = useState<
    'none' | 'import' | 'snapshot' | 'snapshotHistory' | 'referenceUrl'
  >('none')
  const [referenceUrlDraft, setReferenceUrlDraft] = useState<string>(selectedAccount.referenceUrl ?? '')
  const [referenceUrlStatus, setReferenceUrlStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [referenceUrlMessage, setReferenceUrlMessage] = useState<string>('')
  const [showFormatPanel, setShowFormatPanel] = useState<boolean>(false)
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
  const accountLabel = selectedAccount.accountName
  const isBankAccount = selectedAccount.assetKind === 'bank_account'
  const isCreditCard = selectedAccount.assetKind === 'credit_card'
  const supportsTransactions = isBankAccount || isCreditCard
  const supportsCsv = supportsTransactions
  // クレカは取引から当月利用額が計算されるため、スナップショットは廃止
  const supportsSnapshot = !isCreditCard
  const supportsReferenceUrl = selectedAccount.assetKind !== 'cash'
  const effectiveDetailPanel =
    (!supportsCsv && detailPanel === 'import') ||
    (!supportsSnapshot && (detailPanel === 'snapshot' || detailPanel === 'snapshotHistory')) ||
    (!supportsReferenceUrl && detailPanel === 'referenceUrl')
      ? 'none'
      : detailPanel
  const queryClient = useQueryClient()
  const [expenseTxItem, setExpenseTxItem] = useState<AccountTransaction | null>(null)
  const [expenseTxForm, setExpenseTxForm] = useState({
    amount: '',
    categoryId: '',
    date: '',
    notes: '',
    paymentAccountId: '',
  })
  const [expenseTxStatus, setExpenseTxStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [expenseTxMessage, setExpenseTxMessage] = useState('')

  const [linkTxItem, setLinkTxItem] = useState<AccountTransaction | null>(null)
  const [linkExpenseId, setLinkExpenseId] = useState<string>('')
  const [linkTxStatus, setLinkTxStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [linkTxMessage, setLinkTxMessage] = useState('')

  const [viewLinkedTxItem, setViewLinkedTxItem] = useState<AccountTransaction | null>(
    null
  )
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null)
  const [editExpenseForm, setEditExpenseForm] = useState({
    amount: '',
    categoryId: '',
    date: '',
    notes: '',
  })
  const [editExpenseStatus, setEditExpenseStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [editExpenseMessage, setEditExpenseMessage] = useState('')

  const categoriesQuery = useQuery({
    queryKey: ['household', 'categories'],
    queryFn: fetchHouseholdCategories,
    staleTime: 30_000,
    enabled: supportsTransactions,
  })

  const toNumber = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return null
    const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
    return Number.isNaN(num) ? null : num
  }

  const getTxCapacity = (tx: AccountTransaction) => {
    const txAmount = toNumber(tx.amount) ?? 0
    const txAmountAbs = Math.abs(txAmount)
    const linked = toNumber(tx.linkedExpenseAmount) ?? 0
    const remaining = Math.max(0, txAmountAbs - linked)
    return {
      txAmountAbs,
      linkedAmount: linked,
      remaining,
      linkedCount: tx.linkedExpenseCount ?? 0,
      isFullyAllocated: txAmountAbs > 0 && remaining <= 0,
      isPartiallyAllocated: linked > 0 && remaining > 0,
    }
  }

  const openExpenseFromTx = (tx: AccountTransaction) => {
    const { remaining, isFullyAllocated } = getTxCapacity(tx)
    if (isFullyAllocated) return
    setExpenseTxItem(tx)
    setExpenseTxForm({
      amount: remaining > 0 ? String(remaining) : '',
      categoryId: '',
      date: tx.date,
      notes: tx.description || '',
      paymentAccountId: String(selectedAccount.accountId),
    })
    setExpenseTxStatus('idle')
    setExpenseTxMessage('')
  }

  const submitExpenseFromTx = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!expenseTxItem) return
    if (!expenseTxForm.categoryId) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('カテゴリを選択してください。')
      return
    }
    const trimmedAmount = expenseTxForm.amount.trim()
    if (!trimmedAmount) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('金額を入力してください。')
      return
    }
    const submittedAmount = Number(trimmedAmount)
    if (!Number.isFinite(submittedAmount) || submittedAmount <= 0) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('金額は0より大きい数値で入力してください。')
      return
    }
    const { remaining } = getTxCapacity(expenseTxItem)
    if (submittedAmount > remaining + 1e-6) {
      setExpenseTxStatus('error')
      setExpenseTxMessage(
        `明細の残り登録可能金額は ¥${remaining.toLocaleString()} です。`
      )
      return
    }
    setExpenseTxStatus('loading')
    setExpenseTxMessage('')
    try {
      const res = await authFetcher('/api/household/expenses/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: expenseTxForm.amount,
          categoryId: Number(expenseTxForm.categoryId),
          date: expenseTxForm.date,
          notes: expenseTxForm.notes,
          paymentAccountId: Number(expenseTxForm.paymentAccountId),
          sourceTransactionId: expenseTxItem.id,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || '支出の登録に失敗しました。')
      }
      setExpenseTxStatus('success')
      setExpenseTxMessage('支出を登録しました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      window.setTimeout(() => setExpenseTxItem(null), 600)
    } catch (err) {
      setExpenseTxStatus('error')
      setExpenseTxMessage(
        err instanceof Error ? err.message : '支出の登録に失敗しました。'
      )
    }
  }

  const openLinkExpenseFromTx = (tx: AccountTransaction) => {
    const { isFullyAllocated } = getTxCapacity(tx)
    if (isFullyAllocated) return
    setLinkTxItem(tx)
    setLinkExpenseId('')
    setLinkTxStatus('idle')
    setLinkTxMessage('')
  }

  // 表示中の取引はすべて同月なので、最初の取引の日付から月を導出する。
  // この月の「未紐付け支出」を一度だけ取得し、紐付けボタンの有効化判定と
  // モーダル内のプルダウンの両方で同じキャッシュを共有する。
  const linkableMonth = transactions[0]?.date.slice(0, 7) ?? ''
  const linkableExpensesQuery = useQuery<
    Array<{
      id: number
      date: string
      amount: string | null
      notes: string
      categoryName: string
      paymentAccountId: number | null
    }>,
    Error
  >({
    queryKey: [
      'household',
      'expenses',
      'unlinked',
      selectedAccount.accountId,
      linkableMonth,
    ],
    queryFn: async () => {
      if (!linkableMonth) return []
      const [year, month] = linkableMonth.split('-')
      const params = new URLSearchParams({
        year,
        month: String(Number(month)),
        paymentAccountId: String(selectedAccount.accountId),
        unlinkedOnly: 'true',
      })
      const res = await authFetcher(`/api/household/expenses/?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.detail || '支出の取得に失敗しました。')
      }
      return Array.isArray(data) ? data : []
    },
    enabled: Boolean(supportsTransactions && linkableMonth),
    staleTime: 30_000,
  })
  const hasLinkableExpenseForTx = (tx: AccountTransaction) => {
    const { remaining } = getTxCapacity(tx)
    if (remaining <= 0) return false
    return (linkableExpensesQuery.data ?? []).some((expense) => {
      const amount = Number(expense.amount ?? 0)
      return Number.isFinite(amount) && amount > 0 && amount <= remaining + 1e-6
    })
  }

  const submitLinkExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!linkTxItem) return
    if (!linkExpenseId) {
      setLinkTxStatus('error')
      setLinkTxMessage('紐付ける支出を選択してください。')
      return
    }
    setLinkTxStatus('loading')
    setLinkTxMessage('')
    try {
      const res = await authFetcher(
        `/api/household/expenses/${linkExpenseId}/`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTransactionId: linkTxItem.id,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || '紐付けに失敗しました。')
      }
      setLinkTxStatus('success')
      setLinkTxMessage('明細を支出に紐付けました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      window.setTimeout(() => setLinkTxItem(null), 600)
    } catch (err) {
      setLinkTxStatus('error')
      setLinkTxMessage(
        err instanceof Error ? err.message : '紐付けに失敗しました。'
      )
    }
  }

  const linkedExpensesQuery = useQuery<
    Array<{
      id: number
      date: string
      amount: string | null
      notes: string
      categoryId: number
      categoryName: string
      categoryColor: string | null
      paymentAccountId: number | null
      sourceTransactionId: number | null
    }>,
    Error
  >({
    queryKey: [
      'household',
      'expenses',
      'by-tx',
      viewLinkedTxItem?.id ?? null,
    ],
    queryFn: async () => {
      if (!viewLinkedTxItem) return []
      const params = new URLSearchParams({
        sourceTransactionId: String(viewLinkedTxItem.id),
      })
      const res = await authFetcher(`/api/household/expenses/?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.detail || '紐付け支出の取得に失敗しました。')
      }
      return Array.isArray(data) ? data : []
    },
    enabled: Boolean(viewLinkedTxItem),
    staleTime: 0,
  })

  const openViewLinkedExpenses = (tx: AccountTransaction) => {
    setViewLinkedTxItem(tx)
    setEditingExpenseId(null)
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  const closeViewLinkedExpenses = () => {
    setViewLinkedTxItem(null)
    setEditingExpenseId(null)
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  const startEditExpense = (expense: {
    id: number
    date: string
    amount: string | null
    notes: string
    categoryId: number
  }) => {
    setEditingExpenseId(expense.id)
    setEditExpenseForm({
      amount: expense.amount ?? '',
      categoryId: String(expense.categoryId),
      date: expense.date,
      notes: expense.notes ?? '',
    })
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  const cancelEditExpense = () => {
    setEditingExpenseId(null)
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  // 1件しか紐付いていない場合はモーダル展開時に自動で編集モードに入る。
  // 同じモーダルセッションでキャンセル後に再オートする挙動を避けるため
  // tx.id 単位で1回だけ適用する。
  const autoEditAppliedTxIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!viewLinkedTxItem) {
      autoEditAppliedTxIdRef.current = null
      return
    }
    if (autoEditAppliedTxIdRef.current === viewLinkedTxItem.id) return
    const expenses = linkedExpensesQuery.data
    if (!expenses) return
    autoEditAppliedTxIdRef.current = viewLinkedTxItem.id
    if (expenses.length === 1) {
      startEditExpense(expenses[0])
    }
  }, [viewLinkedTxItem, linkedExpensesQuery.data])

  const submitEditExpense = async (
    event: FormEvent<HTMLFormElement>,
    expenseId: number
  ) => {
    event.preventDefault()
    if (!editExpenseForm.categoryId) {
      setEditExpenseStatus('error')
      setEditExpenseMessage('カテゴリを選択してください。')
      return
    }
    if (!editExpenseForm.amount.trim()) {
      setEditExpenseStatus('error')
      setEditExpenseMessage('金額を入力してください。')
      return
    }
    setEditExpenseStatus('loading')
    setEditExpenseMessage('')
    try {
      const res = await authFetcher(`/api/household/expenses/${expenseId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: editExpenseForm.amount,
          categoryId: Number(editExpenseForm.categoryId),
          date: editExpenseForm.date,
          notes: editExpenseForm.notes,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || '支出の更新に失敗しました。')
      }
      setEditExpenseStatus('success')
      setEditExpenseMessage('支出を更新しました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      setEditingExpenseId(null)
    } catch (err) {
      setEditExpenseStatus('error')
      setEditExpenseMessage(
        err instanceof Error ? err.message : '支出の更新に失敗しました。'
      )
    }
  }

  const deleteLinkedExpense = async (expenseId: number) => {
    if (!window.confirm('この支出を削除しますか？')) return
    setEditExpenseStatus('loading')
    setEditExpenseMessage('')
    try {
      const res = await authFetcher(`/api/household/expenses/${expenseId}/`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.detail || '支出の削除に失敗しました。')
      }
      setEditExpenseStatus('idle')
      setEditingExpenseId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
    } catch (err) {
      setEditExpenseStatus('error')
      setEditExpenseMessage(
        err instanceof Error ? err.message : '支出の削除に失敗しました。'
      )
    }
  }

  useEffect(() => {
    if (effectiveDetailPanel === 'none') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailPanel('none')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveDetailPanel])

  const referenceUrlSyncKey = `${selectedAccount.assetKind}:${selectedAccount.accountId}:${
    selectedAccount.referenceUrl ?? ''
  }`
  const [prevReferenceUrlSyncKey, setPrevReferenceUrlSyncKey] = useState<string>(referenceUrlSyncKey)
  if (referenceUrlSyncKey !== prevReferenceUrlSyncKey) {
    setPrevReferenceUrlSyncKey(referenceUrlSyncKey)
    setReferenceUrlDraft(selectedAccount.referenceUrl ?? '')
    setReferenceUrlStatus('idle')
    setReferenceUrlMessage('')
  }

  const saveReferenceUrlMutation = useMutation<{ referenceUrl?: string }, Error, string>({
    mutationFn: async (referenceUrl: string) => {
      const res = await authFetcher(
        `/api/ledger/accounts/${selectedAccount.accountId}/?assetKind=${selectedAccount.assetKind}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceUrl }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'URLの保存に失敗しました。')
      }
      return data
    },
    onMutate: () => {
      setReferenceUrlStatus('loading')
      setReferenceUrlMessage('')
    },
    onSuccess: async () => {
      await onFormatSaved()
      setReferenceUrlStatus('success')
      setReferenceUrlMessage('URLを保存しました。')
    },
    onError: (error) => {
      setReferenceUrlStatus('error')
      setReferenceUrlMessage(error.message || 'URLの保存に失敗しました。')
    },
  })

  const referenceUrlSavedValue = selectedAccount.referenceUrl ?? ''
  const referenceUrlIsDirty = referenceUrlDraft.trim() !== referenceUrlSavedValue
  const referenceUrlIsValid = (() => {
    const trimmed = referenceUrlDraft.trim()
    if (!trimmed) return true
    try {
      const parsed = new URL(trimmed)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  })()

  const handleReferenceUrlSave = () => {
    const trimmed = referenceUrlDraft.trim()
    if (trimmed && !referenceUrlIsValid) {
      setReferenceUrlStatus('error')
      setReferenceUrlMessage('http(s) で始まる有効なURLを入力してください。')
      return
    }
    saveReferenceUrlMutation.mutate(trimmed)
  }

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

  const hasTemplate =
    supportsCsv && (Boolean(selectedAccount.hasCsvTemplate) || formatStatus === 'success')

  const saveTemplateMutation = useMutation<{ created?: number }, Error, FormData>({
    mutationFn: async (formData: FormData) => {
      const res = await authFetcher(
        `/api/ledger/accounts/${selectedAccount.accountId}/csv-templates/`,
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
      await onFormatSaved()
      setShowFormatPanel(false)
      setIsFormatView(true)
      setFormatStatus('success')
      const createdCount = Number(data.created ?? 0)
      if (registerRecordsOnSave) {
        setFormatMessage(`CSVフォーマットを保存し、${createdCount}件を登録しました。`)
      } else {
        setFormatMessage('CSVフォーマットを保存しました。')
      }
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
    if (!supportsCsv || !showFormatPanel || !selectedAccount.hasCsvTemplate) return
    void (async () => {
      try {
        const res = await authFetcher(
          `/api/ledger/accounts/${selectedAccount.accountId}/csv-templates/`
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
    supportsCsv,
    showFormatPanel,
    selectedAccount.hasCsvTemplate,
    selectedAccount.accountId,
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

  const handleDeleteAccount = async () => {
    try {
      await onDeleteAccount(selectedAccount)
    } catch {
      // 表示は親コンポーネントの mutation state を使う
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#e3e9ee] pb-4" />
      <div className="rounded-[14px] border border-[#e3e9ee] bg-[#f9fbfc] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#0f1c22]">
              {isBankAccount
                ? '入出金履歴'
                : isCreditCard
                  ? '利用明細'
                  : selectedAccount.assetKind === 'cash'
                    ? '現金管理'
                    : '金融資産'}
            </p>
            {supportsTransactions && (
              <p className="text-xs text-[#5d6a72]">最新の取引を表示しています。</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {supportsTransactions && (
              <span className="text-xs text-[#5d6a72]">{transactions.length} 件</span>
            )}
            <span className="text-xs text-[#7a8790]">{accountLabel}</span>
            {(() => {
              const importItems: DropdownMenuItem[] = []
              if (supportsCsv && importPanel) {
                importItems.push({
                  key: 'import',
                  label: 'CSV登録',
                  onSelect: () => setDetailPanel('import'),
                })
              }
              if (supportsSnapshot) {
                importItems.push({
                  key: 'snapshot',
                  label: 'スナップショット登録',
                  onSelect: () => setDetailPanel('snapshot'),
                })
                importItems.push({
                  key: 'snapshotHistory',
                  label: 'スナップショット履歴',
                  onSelect: () => setDetailPanel('snapshotHistory'),
                })
              }
              return importItems.length === 0 ? null : (
                <DropdownMenu
                  items={importItems}
                  trigger={({ open, toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                        open
                          ? 'border-[#1a7b6d] bg-[#1a7b6d] text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)]'
                          : 'border-[#d7dee4] bg-white text-[#0f1c22] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(16,38,49,0.12)]'
                      }`}
                    >
                      取込 <span aria-hidden className="ml-1 text-[10px]">▾</span>
                    </button>
                  )}
                />
              )
            })()}
            {(() => {
              const settingItems: DropdownMenuItem[] = []
              if (supportsCsv) {
                settingItems.push({
                  key: 'format',
                  label: hasTemplate ? 'CSVフォーマット編集' : 'CSVフォーマット登録',
                  onSelect: () => {
                    if (!selectedAccount.hasCsvTemplate) setIsFormatView(false)
                    setShowFormatPanel(true)
                  },
                })
              }
              if (supportsReferenceUrl) {
                settingItems.push({
                  key: 'reference-url',
                  label: supportsCsv ? 'ダウンロード元URLを設定' : '資産ページURLを設定',
                  onSelect: () => setDetailPanel('referenceUrl'),
                })
                if (referenceUrlSavedValue) {
                  settingItems.push({
                    key: 'open-url',
                    label: supportsCsv ? 'ダウンロードページを開く' : 'ページを開く',
                    onSelect: () => window.open(referenceUrlSavedValue, '_blank', 'noopener'),
                  })
                }
              }
              if (settingItems.length === 0) return null
              return (
                <DropdownMenu
                  items={settingItems}
                  trigger={({ open, toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                        open
                          ? 'border-[#1a7b6d] bg-[#1a7b6d] text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)]'
                          : 'border-[#d7dee4] bg-white text-[#0f1c22] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(16,38,49,0.12)]'
                      }`}
                    >
                      設定 <span aria-hidden className="ml-1 text-[10px]">▾</span>
                    </button>
                  )}
                />
              )
            })()}
          </div>
        </div>
        {supportsTransactions && transactionStatus === 'loading' && (
          <div className="mt-3 rounded-[10px] border border-[#d7dee4] bg-white px-4 py-3 text-sm text-[#5d6a72]">
            取引を読み込んでいます...
          </div>
        )}
        {supportsTransactions && transactionStatus === 'error' && transactionMessage && (
          <div className={`mt-3 rounded-[10px] px-4 py-3 text-sm ${statusClassName('error')}`}>
            {transactionMessage}
          </div>
        )}
        {supportsTransactions && transactionStatus === 'success' && transactions.length === 0 && (
          <div className="mt-3 rounded-[10px] border border-dashed border-[#d7dee4] bg-white px-4 py-3 text-sm text-[#5d6a72]">
            取引がまだ登録されていません。
          </div>
        )}
        {supportsTransactions && transactionStatus === 'success' && transactions.length > 0 && (
          <div className="mt-3 divide-y divide-[#e3e9ee] rounded-[10px] border border-[#e3e9ee] bg-white">
            {transactions.map((tx) => {
              const amountValue = toNumber(tx.amount) ?? 0
              const amountClass =
                amountValue < 0
                  ? 'text-[#b23b3b]'
                  : amountValue > 0
                    ? 'text-[#167353]'
                    : 'text-[#0f1c22]'
              const capacity = getTxCapacity(tx)
              const hasTransferLink = Boolean(tx.linkedTransferId)
              const canConvertToExpense = amountValue < 0 && !hasTransferLink
              return (
                <div
                  key={tx.id}
                  className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#0f1c22]">
                      {tx.description || '取引'}
                    </p>
                    <p className="text-xs text-[#5d6a72]">{tx.date}</p>
                    {tx.notes && <p className="text-xs text-[#7a8790]">{tx.notes}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right md:flex-row md:items-center md:gap-3">
                    <div>
                      <p className={`text-base font-bold ${amountClass}`}>
                        {displayAmount(tx.amount)}
                      </p>
                      {tx.balance !== null && tx.balance !== undefined && tx.balance !== '' && (
                        <p className="text-xs text-[#5d6a72]">
                          残高 {displayAmount(tx.balance)}
                        </p>
                      )}
                    </div>
                    <TxTransferActions
                      tx={tx}
                      account={selectedAccount}
                      displayAmount={displayAmount}
                    >
                      {(transferState) => (
                        <TxRowActions
                          capacity={capacity}
                          canConvertToExpense={canConvertToExpense}
                          hasLinkableExpense={hasLinkableExpenseForTx(tx)}
                          transfer={transferState}
                          onOpenExpense={() => openExpenseFromTx(tx)}
                          onOpenLinkExpense={() => openLinkExpenseFromTx(tx)}
                          onOpenViewLinked={() => openViewLinkedExpenses(tx)}
                        />
                      )}
                    </TxTransferActions>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedAccount.assetKind === 'cash' && (
        <CashHistoryPanel
          account={selectedAccount}
          month={selectedMonth}
          displayAmount={displayAmount}
        />
      )}

{supportsCsv && showFormatPanel && (
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
              {selectedAccount.hasCsvTemplate && isFormatView && (
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
      )}
      <div className="rounded-[14px] border border-[#f0cdcd] bg-[#fff8f8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#7f1d1d]">資産の削除</p>
            <p className="text-xs text-[#8d3f3f]">
              この操作は取り消せません。関連データも削除される場合があります。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDeleteAccount()}
            disabled={deleteStatus === 'loading'}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              deleteStatus === 'loading'
                ? 'cursor-not-allowed border-[#e3b7b7] bg-[#f8ecec] text-[#8d3f3f]'
                : 'border-[#d9a7a7] bg-white text-[#8d3f3f] hover:-translate-y-0.5 hover:bg-[#fff5f5] hover:shadow-[0_10px_24px_rgba(127,29,29,0.14)]'
            }`}
          >
            {deleteStatus === 'loading' ? '削除中...' : '資産を削除'}
          </button>
        </div>
        {deleteStatus === 'error' && deleteMessage && (
          <div className={`mt-3 rounded-[10px] px-4 py-3 text-sm ${statusClassName('error')}`}>
            {deleteMessage}
          </div>
        )}
      </div>
      {expenseTxItem && (
        <ModalBackdrop onClose={() => setExpenseTxItem(null)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">明細を支出に変換</p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  この明細を家計支出として登録します。明細とは自動的に紐付きます。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setExpenseTxItem(null)}
              >
                閉じる
              </button>
            </div>
            <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
              <div>明細日: {expenseTxItem.date}</div>
              <div>明細内容: {expenseTxItem.description || '—'}</div>
              <div>明細金額: {displayAmount(expenseTxItem.amount)}</div>
              {(() => {
                const capacity = getTxCapacity(expenseTxItem)
                if (capacity.linkedAmount <= 0) return null
                return (
                  <>
                    <div>
                      既に登録: ¥{capacity.linkedAmount.toLocaleString()}
                      {capacity.linkedCount > 0 && `（${capacity.linkedCount}件）`}
                    </div>
                    <div className="text-[#1a7b6d]">
                      残り登録可能: ¥{capacity.remaining.toLocaleString()}
                    </div>
                  </>
                )
              })()}
            </div>
            <form className="mt-4 grid gap-3" onSubmit={submitExpenseFromTx}>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>カテゴリ</span>
                <CategoryTreeSelect
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  categories={categoriesQuery.data ?? []}
                  value={expenseTxForm.categoryId}
                  onChange={(next) =>
                    setExpenseTxForm((prev) => ({ ...prev, categoryId: next }))
                  }
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>金額</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={getTxCapacity(expenseTxItem).remaining || undefined}
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={expenseTxForm.amount}
                    onChange={(event) =>
                      setExpenseTxForm((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>日付</span>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={expenseTxForm.date}
                    onChange={(event) =>
                      setExpenseTxForm((prev) => ({ ...prev, date: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>備考</span>
                <input
                  type="text"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={expenseTxForm.notes}
                  onChange={(event) =>
                    setExpenseTxForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <div className="flex items-center justify-end gap-3 pt-1">
                {expenseTxStatus !== 'idle' && expenseTxMessage && (
                  <span
                    className={`text-[0.7rem] ${
                      expenseTxStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                    }`}
                  >
                    {expenseTxMessage}
                  </span>
                )}
                <button
                  type="submit"
                  disabled={expenseTxStatus === 'loading'}
                  className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                >
                  {expenseTxStatus === 'loading' ? '登録中...' : '支出として登録'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {linkTxItem && (
        <ModalBackdrop onClose={() => setLinkTxItem(null)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">既存の支出と紐付け</p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  この明細を、未紐付けの既存支出に紐付けます。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setLinkTxItem(null)}
              >
                閉じる
              </button>
            </div>
            <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
              <div>明細日: {linkTxItem.date}</div>
              <div>明細内容: {linkTxItem.description || '—'}</div>
              <div>明細金額: {displayAmount(linkTxItem.amount)}</div>
              {(() => {
                const cap = getTxCapacity(linkTxItem)
                if (cap.linkedAmount <= 0) return null
                return (
                  <>
                    <div>既に登録: ¥{cap.linkedAmount.toLocaleString()}</div>
                    <div className="text-[#1a7b6d]">
                      残り登録可能: ¥{cap.remaining.toLocaleString()}
                    </div>
                  </>
                )
              })()}
            </div>
            <form className="mt-4 grid gap-3" onSubmit={submitLinkExpense}>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>
                  紐付ける支出 (同月・{selectedAccount.accountName}/未割当・残額¥
                  {getTxCapacity(linkTxItem).remaining.toLocaleString()}以下)
                </span>
                {(() => {
                  const remaining = getTxCapacity(linkTxItem).remaining
                  const filtered = (linkableExpensesQuery.data ?? []).filter(
                    (expense) => {
                      const amount = Number(expense.amount ?? 0)
                      return (
                        Number.isFinite(amount) &&
                        amount > 0 &&
                        amount <= remaining + 1e-6
                      )
                    }
                  )
                  return (
                    <select
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={linkExpenseId}
                      onChange={(event) => setLinkExpenseId(event.target.value)}
                    >
                      <option value="">
                        {linkableExpensesQuery.isLoading
                          ? '読み込み中...'
                          : filtered.length === 0
                            ? '金額条件に合う支出がありません'
                            : '支出を選択してください'}
                      </option>
                      {filtered.map((expense) => {
                        const unassigned = expense.paymentAccountId == null
                        return (
                          <option key={expense.id} value={expense.id}>
                            {expense.date} / {expense.categoryName} / ¥{Number(expense.amount ?? 0).toLocaleString()}
                            {expense.notes ? ` / ${expense.notes}` : ''}
                            {unassigned ? ' [支払元未割当]' : ''}
                          </option>
                        )
                      })}
                    </select>
                  )
                })()}
              </label>
              {linkableExpensesQuery.isError && (
                <p className="text-[0.7rem] text-[#a33a2b]">
                  {linkableExpensesQuery.error?.message ?? '支出の取得に失敗しました。'}
                </p>
              )}
              <p className="text-[0.65rem] text-[#7a8790]">
                支払元: 同口座 / 未割当 の支出のみ表示。未割当は紐付け時に「{selectedAccount.accountName}」に自動セット。
              </p>
              <div className="flex items-center justify-end gap-3 pt-1">
                {linkTxStatus !== 'idle' && linkTxMessage && (
                  <span
                    className={`text-[0.7rem] ${
                      linkTxStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                    }`}
                  >
                    {linkTxMessage}
                  </span>
                )}
                <button
                  type="submit"
                  disabled={linkTxStatus === 'loading' || !linkExpenseId}
                  className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                >
                  {linkTxStatus === 'loading' ? '紐付け中...' : '紐付ける'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {viewLinkedTxItem && (
        <ModalBackdrop onClose={closeViewLinkedExpenses}>
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[560px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">
                  紐付け済みの支出
                  {linkedExpensesQuery.data && linkedExpensesQuery.data.length > 0 && (
                    <span className="ml-2 text-xs text-[#5d6a72]">
                      ({linkedExpensesQuery.data.length}件)
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  この明細に紐付いた支出を編集/削除します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={closeViewLinkedExpenses}
              >
                閉じる
              </button>
            </div>
            <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
              <div>明細日: {viewLinkedTxItem.date}</div>
              <div>明細内容: {viewLinkedTxItem.description || '—'}</div>
              <div>明細金額: {displayAmount(viewLinkedTxItem.amount)}</div>
              {(() => {
                const cap = getTxCapacity(viewLinkedTxItem)
                return (
                  <div className={cap.remaining > 0 ? 'text-[#1a7b6d]' : 'text-[#0e4f2c]'}>
                    合計 ¥{cap.linkedAmount.toLocaleString()} / 明細 ¥
                    {cap.txAmountAbs.toLocaleString()}
                    {cap.remaining > 0
                      ? ` ・残 ¥${cap.remaining.toLocaleString()}`
                      : ' ・全額紐付け済み'}
                  </div>
                )
              })()}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {linkedExpensesQuery.isLoading && (
                <div className="rounded-2xl border border-[#e3e9ee] bg-white p-3 text-xs text-[#5d6a72]">
                  読み込み中...
                </div>
              )}
              {linkedExpensesQuery.isError && (
                <div className="rounded-2xl border border-[#f2b4b4] bg-[#fff1f2] p-3 text-xs text-[#a33a2b]">
                  {linkedExpensesQuery.error?.message ??
                    '紐付け支出の取得に失敗しました。'}
                </div>
              )}
              {linkedExpensesQuery.data?.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#d7dee4] bg-white p-3 text-xs text-[#5d6a72]">
                  紐付いた支出はありません。
                </div>
              )}
              {(linkedExpensesQuery.data ?? []).map((expense) => {
                const isEditing = editingExpenseId === expense.id
                return (
                  <div
                    key={expense.id}
                    className="rounded-2xl border border-[#e3e9ee] bg-white p-3 text-xs"
                  >
                    {!isEditing ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor: resolveCategoryColor(
                                  expense.categoryName,
                                  expense.categoryColor
                                ),
                              }}
                            />
                            <span className="text-sm font-semibold text-[#0f1c22]">
                              {expense.categoryName}
                            </span>
                            <span className="text-[#5d6a72]">{expense.date}</span>
                          </div>
                          <div className="mt-1 text-sm font-bold text-[#0f1c22]">
                            ¥{Number(expense.amount ?? 0).toLocaleString()}
                          </div>
                          {expense.notes && (
                            <div className="mt-0.5 text-[#5d6a72]">
                              {expense.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            className={buttonClasses({
                              variant: 'secondary',
                              size: 'xs',
                              shape: 'pill',
                            })}
                            onClick={() => startEditExpense(expense)}
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            className={buttonClasses({
                              variant: 'danger',
                              size: 'xs',
                              shape: 'pill',
                            })}
                            onClick={() => deleteLinkedExpense(expense.id)}
                            disabled={editExpenseStatus === 'loading'}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ) : (
                      <form
                        className="grid gap-2"
                        onSubmit={(event) => submitEditExpense(event, expense.id)}
                      >
                        <label className="grid gap-1 font-semibold text-[#0f1c22]">
                          <span>カテゴリ</span>
                          <CategoryTreeSelect
                            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                            categories={categoriesQuery.data ?? []}
                            value={editExpenseForm.categoryId}
                            onChange={(next) =>
                              setEditExpenseForm((prev) => ({
                                ...prev,
                                categoryId: next,
                              }))
                            }
                          />
                        </label>
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="grid gap-1 font-semibold text-[#0f1c22]">
                            <span>金額</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                              value={editExpenseForm.amount}
                              onChange={(event) =>
                                setEditExpenseForm((prev) => ({
                                  ...prev,
                                  amount: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="grid gap-1 font-semibold text-[#0f1c22]">
                            <span>日付</span>
                            <input
                              type="date"
                              className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                              value={editExpenseForm.date}
                              onChange={(event) =>
                                setEditExpenseForm((prev) => ({
                                  ...prev,
                                  date: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <label className="grid gap-1 font-semibold text-[#0f1c22]">
                          <span>備考</span>
                          <input
                            type="text"
                            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                            value={editExpenseForm.notes}
                            onChange={(event) =>
                              setEditExpenseForm((prev) => ({
                                ...prev,
                                notes: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            className={buttonClasses({
                              variant: 'danger',
                              size: 'xs',
                              shape: 'pill',
                            })}
                            onClick={() => deleteLinkedExpense(expense.id)}
                            disabled={editExpenseStatus === 'loading'}
                          >
                            削除
                          </button>
                          <div className="flex items-center gap-2">
                            {editExpenseStatus !== 'idle' && editExpenseMessage && (
                              <span
                                className={`text-[0.7rem] ${
                                  editExpenseStatus === 'error'
                                    ? 'text-[#a33a2b]'
                                    : 'text-[#0e4f2c]'
                                }`}
                              >
                                {editExpenseMessage}
                              </span>
                            )}
                            <button
                              type="button"
                              className={buttonClasses({
                                variant: 'secondary',
                                size: 'xs',
                                shape: 'pill',
                              })}
                              onClick={cancelEditExpense}
                            >
                              キャンセル
                            </button>
                            <button
                              type="submit"
                              disabled={editExpenseStatus === 'loading'}
                              className={buttonClasses({
                                variant: 'primary',
                                size: 'xs',
                                shape: 'pill',
                              })}
                            >
                              {editExpenseStatus === 'loading' ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </ModalBackdrop>
      )}

      {effectiveDetailPanel !== 'none' && (
        <ModalBackdrop
          onClose={() => setDetailPanel('none')}
          className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(15,28,34,0.45)] px-4 py-6"
        >
          <div className="mt-4 w-full max-w-[720px] rounded-[18px] border border-[#d7dee4] bg-white p-6 shadow-[0_24px_60px_rgba(15,28,34,0.28)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-[#0f1c22]">
                {effectiveDetailPanel === 'import'
                  ? 'CSV登録'
                  : effectiveDetailPanel === 'snapshotHistory'
                    ? 'スナップショット履歴'
                    : effectiveDetailPanel === 'referenceUrl'
                      ? supportsCsv
                        ? 'CSVダウンロード元URL'
                        : '資産ページのURL'
                      : 'スナップショット登録'}
              </p>
              <button
                type="button"
                onClick={() => setDetailPanel('none')}
                className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 text-xs font-bold text-[#0f1c22] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(16,38,49,0.12)]"
              >
                閉じる
              </button>
            </div>
            <div className="mt-4">
              {effectiveDetailPanel === 'import' &&
                (importPanel ?? (
                  <div className="rounded-[12px] border border-dashed border-[#d7dee4] bg-[#f8fafb] p-4 text-[#5d6a72]">
                    口座詳細の画面は現在準備中です。
                  </div>
                ))}
              {effectiveDetailPanel === 'snapshot' &&
                (snapshotPanel ?? (
                  <div className="rounded-[12px] border border-dashed border-[#d7dee4] bg-[#f8fafb] p-4 text-[#5d6a72]">
                    口座詳細の画面は現在準備中です。
                  </div>
                ))}
              {effectiveDetailPanel === 'snapshotHistory' &&
                (snapshotHistoryPanel ?? (
                  <div className="rounded-[12px] border border-dashed border-[#d7dee4] bg-[#f8fafb] p-4 text-[#5d6a72]">
                    スナップショット履歴の画面は現在準備中です。
                  </div>
                ))}
              {effectiveDetailPanel === 'referenceUrl' && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-[#7a8790]">
                    {supportsCsv
                      ? 'CSVをダウンロードする明細ページのURLを保存できます。'
                      : '評価額を確認できるページのURLを保存できます。'}
                  </p>
                  <div className="flex flex-wrap items-stretch gap-2">
                    <input
                      type="url"
                      value={referenceUrlDraft}
                      onChange={(event) => setReferenceUrlDraft(event.target.value)}
                      placeholder="https://..."
                      className="min-w-0 flex-1 rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-sm text-[#0f1c22]"
                    />
                    <button
                      type="button"
                      onClick={handleReferenceUrlSave}
                      disabled={referenceUrlStatus === 'loading' || !referenceUrlIsDirty}
                      className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                        referenceUrlStatus === 'loading' || !referenceUrlIsDirty
                          ? 'cursor-not-allowed border-[#d7dee4] bg-[#f3f5f7] text-[#9aa6ad]'
                          : 'border-[#1a7b6d] bg-[#1a7b6d] text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)] hover:-translate-y-0.5'
                      }`}
                    >
                      {referenceUrlStatus === 'loading' ? '保存中...' : '保存'}
                    </button>
                  </div>
                  {referenceUrlSavedValue && (
                    <a
                      href={referenceUrlSavedValue}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="self-start rounded-full border border-[#1a7b6d] bg-[#1a7b6d] px-3 py-1.5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)] transition hover:-translate-y-0.5"
                    >
                      {supportsCsv ? 'ダウンロードページを開く' : 'ページを開く'}
                    </a>
                  )}
                  {referenceUrlMessage && referenceUrlStatus !== 'idle' && referenceUrlStatus !== 'loading' && (
                    <div
                      className={`rounded-[10px] px-4 py-3 text-sm ${statusClassName(
                        referenceUrlStatus === 'success' ? 'success' : 'error'
                      )}`}
                    >
                      {referenceUrlMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  )
}

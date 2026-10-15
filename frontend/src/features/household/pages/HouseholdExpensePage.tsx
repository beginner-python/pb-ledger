import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, Pie } from 'react-chartjs-2'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'

import { authFetcher } from '../../../api/client'
import { buttonClasses } from '../../../ui/button'
import MonthPicker from '../../shared/components/MonthPicker'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import { useMonth } from '../../shared/state/MonthContext'
import { toLocalDateString } from '../../shared/utils/date'
import { fetchPaymentAccounts } from '../services/household'
import { resolveCategoryColor } from '../utils/categoryColors'
import CategoryTreeSelect from '../components/CategoryTreeSelect'
import CategoryBreakdownList from '../components/CategoryBreakdownList'
import type { HouseholdCategoryOption } from '../types/householdTypes'

const PAYMENT_KIND_LABELS: Record<string, string> = {
  bank_account: '銀行',
  credit_card: 'カード',
  cash: '現金',
}

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, ArcElement)

type LinkedTransactionSummary = {
  id: number
  date: string
  description: string
  amount: string
}

type HouseholdExpenseItem = {
  id: number
  date: string
  amount: string | null
  notes: string
  categoryId: number
  categoryName: string
  categoryColor: string | null
  paymentAccountId: number | null
  paymentAccountName: string | null
  paymentAccountType: string | null
  sourceTransactionId: number | null
  sourceCashAdjustmentId: number | null
  sourceTransaction: LinkedTransactionSummary | null
}

type LinkableTransaction = {
  id: number
  date: string
  description: string
  amount: string
  linkedExpenseAmount?: string
  linkedExpenseCount?: number
}

type HouseholdSummaryItem = {
  categoryId: number
  categoryName: string
  categoryColor: string | null
  parentCategoryId: number | null
  total: string | null
}

type HouseholdSummary = {
  year: number
  month: number
  total: string | null
  items: HouseholdSummaryItem[]
}

type ExpenseSortKey = 'date' | 'amount' | 'category'
type SortDirection = 'asc' | 'desc'

const yenFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const formatYen = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return '¥-'
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  if (Number.isNaN(num)) return '¥-'
  return yenFormatter.format(num)
}

const getShowAmounts = (): boolean => {
  try {
    const stored = localStorage.getItem('showAmounts')
    if (stored === null) return true
    return stored === 'true'
  } catch {
    return true
  }
}

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return 0
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return Number.isNaN(num) ? 0 : num
}

const parseJsonSafely = async (res: Response) => {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

type TriStateValue = 'any' | 'with' | 'without'

const TRI_STATE_CYCLE: Record<TriStateValue, TriStateValue> = {
  any: 'with',
  with: 'without',
  without: 'any',
}

function TriStateFilterButton({
  label,
  value,
  onChange,
}: {
  label: string
  value: TriStateValue
  onChange: (next: TriStateValue) => void
}) {
  const isAny = value === 'any'
  const isWith = value === 'with'
  // 「あり」は primary (緑系)、「なし」は danger 系で区別。「指定なし」は secondary。
  const variant: 'primary' | 'secondary' | 'danger' = isAny
    ? 'secondary'
    : isWith
      ? 'primary'
      : 'danger'
  const stateLabel = isAny ? '' : isWith ? ' あり' : ' なし'
  return (
    <button
      type="button"
      className={buttonClasses({ variant, size: 'xs', shape: 'pill' })}
      aria-label={`${label}フィルタ: ${isAny ? '指定なし' : isWith ? 'あり' : 'なし'}`}
      onClick={() => onChange(TRI_STATE_CYCLE[value])}
    >
      {label}
      {stateLabel}
    </button>
  )
}

export default function HouseholdExpensePage() {
  const today = useMemo(() => new Date(), [])
  const { year: targetYear, month: targetMonth, setYearMonth } = useMonth()
  const targetDate = useMemo(
    () => ({ year: targetYear, month: targetMonth }),
    [targetYear, targetMonth]
  )
  const [showAmounts, setShowAmounts] = useState<boolean>(() => getShowAmounts())
  const displayAmount = (value: number | string | null | undefined) =>
    showAmounts ? formatYen(value) : '******'
  const formatDelta = (value: number | null) => {
    if (!showAmounts) return '******'
    if (value === null || Number.isNaN(value)) return '¥-'
    const sign = value > 0 ? '+' : value < 0 ? '-' : ''
    const abs = yenFormatter.format(Math.abs(value))
    return `${sign}${abs}`
  }
  const previousMonth = useMemo(() => {
    if (targetDate.month === 1) {
      return { year: targetDate.year - 1, month: 12 }
    }
    return { year: targetDate.year, month: targetDate.month - 1 }
  }, [targetDate])
  const [expenseEditItem, setExpenseEditItem] = useState<HouseholdExpenseItem | null>(null)
  const [expenseEditForm, setExpenseEditForm] = useState({
    amount: '',
    category: '',
    date: '',
    notes: '',
    paymentAccountId: '',
    sourceTransactionId: '',
  })
  const [expenseEditStatus, setExpenseEditStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [expenseEditMessage, setExpenseEditMessage] = useState('')
  // 一覧上の操作 (削除など) の結果。編集モーダルの外に表示する。
  const [listActionMessage, setListActionMessage] = useState('')
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    category: '',
    date: toLocalDateString(today),
    notes: '',
    paymentAccountId: '',
  })
  const [expenseSubmitStatus, setExpenseSubmitStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [expenseSubmitMessage, setExpenseSubmitMessage] = useState('')
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [listFilters, setListFilters] = useState<{
    categoryId: string
    notes: 'any' | 'with' | 'without'
    link: 'any' | 'with' | 'without'
  }>({ categoryId: 'all', notes: 'any', link: 'any' })
  const [chartCategoryFilter, setChartCategoryFilter] = useState('all')
  const [expenseSortKey, setExpenseSortKey] = useState<ExpenseSortKey>('date')
  const [expenseSortDirection, setExpenseSortDirection] = useState<SortDirection>('desc')
  const queryClient = useQueryClient()

  const {
    data: expenseList,
    status: expenseListStatus,
    error: expenseListError,
  } = useQuery<HouseholdExpenseItem[], Error>({
    queryKey: ['household', 'expenses', targetDate.year, targetDate.month],
    queryFn: async () => {
      const params = new URLSearchParams({
        year: String(targetDate.year),
        month: String(targetDate.month),
      })
      const res = await authFetcher(`/api/household/expenses/?${params.toString()}`)
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '支出一覧の取得に失敗しました。')
      }
      return parsed as HouseholdExpenseItem[]
    },
    staleTime: 0,
  })

  const {
    data: summaryData,
    status: summaryStatus,
    error: summaryError,
  } = useQuery<HouseholdSummary, Error>({
    queryKey: ['household', 'summary', targetDate.year, targetDate.month],
    queryFn: async () => {
      const params = new URLSearchParams({
        year: String(targetDate.year),
        month: String(targetDate.month),
      })
      const res = await authFetcher(`/api/household/expenses/summary/?${params.toString()}`)
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '支出サマリーの取得に失敗しました。')
      }
      return parsed as HouseholdSummary
    },
    staleTime: 0,
  })

  const { data: previousSummaryData } = useQuery<HouseholdSummary, Error>({
    queryKey: ['household', 'summary', previousMonth.year, previousMonth.month],
    queryFn: async () => {
      const params = new URLSearchParams({
        year: String(previousMonth.year),
        month: String(previousMonth.month),
      })
      const res = await authFetcher(`/api/household/expenses/summary/?${params.toString()}`)
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '支出サマリーの取得に失敗しました。')
      }
      return parsed as HouseholdSummary
    },
    staleTime: 0,
  })

  const {
    data: categoryOptions,
    status: categoryStatus,
    error: categoryError,
  } = useQuery<HouseholdCategoryOption[], Error>({
    queryKey: ['household', 'categories'],
    queryFn: async () => {
      const res = await authFetcher('/api/household/categories/')
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || 'カテゴリ取得に失敗しました。')
      }
      return parsed as HouseholdCategoryOption[]
    },
    staleTime: 0,
  })

  const sortedCategories = useMemo(() => {
    return (categoryOptions ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [categoryOptions])

  const { data: paymentAccountList } = useQuery({
    queryKey: ['ledger', 'payment-accounts'],
    queryFn: fetchPaymentAccounts,
    staleTime: 30_000,
  })
  const paymentAccounts = paymentAccountList ?? []

  const linkableTxAccountId = expenseEditForm.paymentAccountId
    ? Number(expenseEditForm.paymentAccountId)
    : null
  const linkableTxMonth = expenseEditForm.date
    ? expenseEditForm.date.slice(0, 7)
    : ''

  const { data: linkableTxData } = useQuery<LinkableTransaction[], Error>({
    queryKey: ['transactions', 'linkable', linkableTxAccountId, linkableTxMonth],
    queryFn: async () => {
      if (!linkableTxAccountId || !linkableTxMonth) return []
      const res = await authFetcher(
        `/api/ledger/accounts/${linkableTxAccountId}/transactions/?limit=200&month=${linkableTxMonth}`
      )
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.error || '明細の取得に失敗しました。')
      }
      return (parsed?.transactions ?? []) as LinkableTransaction[]
    },
    enabled: Boolean(expenseEditItem && linkableTxAccountId && linkableTxMonth),
    staleTime: 0,
  })

  const summaryChartData = useMemo(() => {
    const items = summaryData?.items ?? []
    const values = items.map((item) => toNumber(item.total))
    const labels = items.map((item) => item.categoryName)
    const colors = items.map((item) =>
      resolveCategoryColor(item.categoryName, item.categoryColor)
    )
    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    }
  }, [summaryData])

  // カテゴリフィルタを適用する ID 集合。親カテゴリ選択時は親 + 直下の子も含める。
  const listCategoryFilterIds = useMemo<Set<number> | null>(() => {
    if (listFilters.categoryId === 'all') return null
    const id = Number(listFilters.categoryId)
    if (!Number.isFinite(id)) return null
    const childIds = sortedCategories
      .filter((c) => c.parentId === id)
      .map((c) => c.id)
    return new Set<number>([id, ...childIds])
  }, [listFilters.categoryId, sortedCategories])

  const filteredExpenseList = useMemo(() => {
    const items = expenseList ?? []
    return items.filter((item) => {
      if (listCategoryFilterIds && !listCategoryFilterIds.has(item.categoryId)) {
        return false
      }
      const noteFilled = Boolean(item.notes?.trim())
      if (listFilters.notes === 'with' && !noteFilled) return false
      if (listFilters.notes === 'without' && noteFilled) return false
      const linked = Boolean(item.sourceTransactionId || item.sourceCashAdjustmentId)
      if (listFilters.link === 'with' && !linked) return false
      if (listFilters.link === 'without' && linked) return false
      return true
    })
  }, [expenseList, listFilters, listCategoryFilterIds])

  const isListFiltered =
    listFilters.categoryId !== 'all' ||
    listFilters.notes !== 'any' ||
    listFilters.link !== 'any'

  const clearListFilters = () =>
    setListFilters({ categoryId: 'all', notes: 'any', link: 'any' })

  const sortedExpenseList = useMemo(() => {
    const direction = expenseSortDirection === 'asc' ? 1 : -1

    return filteredExpenseList.slice().sort((a, b) => {
      let result = 0

      if (expenseSortKey === 'date') {
        result = a.date.localeCompare(b.date)
      } else if (expenseSortKey === 'amount') {
        result = toNumber(a.amount) - toNumber(b.amount)
      } else {
        result = a.categoryName.localeCompare(b.categoryName, 'ja')
      }

      if (result !== 0) return result * direction
      return (a.id - b.id) * direction
    })
  }, [expenseSortDirection, expenseSortKey, filteredExpenseList])

  const filteredTotalAmount = useMemo(() => {
    return filteredExpenseList.reduce((sum, item) => sum + toNumber(item.amount), 0)
  }, [filteredExpenseList])

  const chartCategoryFilterIds = useMemo<Set<number> | null>(() => {
    if (chartCategoryFilter === 'all') return null
    const id = Number(chartCategoryFilter)
    if (!Number.isFinite(id)) return null
    const childIds = sortedCategories
      .filter((c) => c.parentId === id)
      .map((c) => c.id)
    return new Set<number>([id, ...childIds])
  }, [chartCategoryFilter, sortedCategories])

  const chartSourceList = useMemo(() => {
    const items = expenseList ?? []
    if (chartCategoryFilterIds === null) return items
    return items.filter((item) => chartCategoryFilterIds.has(item.categoryId))
  }, [chartCategoryFilterIds, expenseList])

  const listCategoryLabel = useMemo(() => {
    if (listFilters.categoryId === 'all') return '支出合計'
    const categoryId = Number(listFilters.categoryId)
    const category = sortedCategories.find((item) => item.id === categoryId)
    return category?.name ?? 'カテゴリ合計'
  }, [listFilters.categoryId, sortedCategories])

  const chartCategoryLabel = useMemo(() => {
    if (chartCategoryFilter === 'all') return '日別支出（カテゴリ別）'
    const categoryId = Number(chartCategoryFilter)
    const category = sortedCategories.find((item) => item.id === categoryId)
    return category?.name ?? 'カテゴリ別'
  }, [chartCategoryFilter, sortedCategories])

  const chartTitleLabel = useMemo(() => {
    if (chartCategoryFilter === 'all') return '日別支出（カテゴリ別）'
    return `${chartCategoryLabel}の日別支出`
  }, [chartCategoryFilter, chartCategoryLabel])

  const dailyStackedData = useMemo(() => {
    const items = chartSourceList
    const lastDay = new Date(targetDate.year, targetDate.month, 0).getDate()
    const labels = Array.from({ length: lastDay }, (_, index) => `${index + 1}`)
    const categoryMap = new Map<
      number,
      { name: string; color: string; values: number[] }
    >()

    for (const item of items) {
      const day = Number(item.date.split('-')[2] || 0)
      if (!day || day > lastDay) continue
      if (!categoryMap.has(item.categoryId)) {
        categoryMap.set(item.categoryId, {
          name: item.categoryName,
          color: resolveCategoryColor(item.categoryName, item.categoryColor),
          values: Array.from({ length: lastDay }, () => 0),
        })
      }
      const category = categoryMap.get(item.categoryId)
      if (!category) continue
      category.values[day - 1] += toNumber(item.amount)
    }

    const datasets = Array.from(categoryMap.values()).map((category) => ({
      label: category.name,
      data: category.values,
      backgroundColor: category.color,
      borderRadius: 0,
      borderSkipped: false,
    }))

    return { labels, datasets }
  }, [chartSourceList, targetDate.month, targetDate.year])

  const totalAmount = useMemo(() => {
    return (expenseList ?? []).reduce((sum, item) => sum + toNumber(item.amount), 0)
  }, [expenseList])

  const summaryTotal = summaryData?.total ?? null
  const previousSummaryTotal = previousSummaryData?.total ?? null
  const monthOverMonthChange =
    summaryTotal !== null && previousSummaryTotal !== null
      ? toNumber(summaryTotal) - toNumber(previousSummaryTotal)
      : null
  const hasSummaryItems = (summaryData?.items ?? []).length > 0

  const openExpenseEdit = (expense: HouseholdExpenseItem) => {
    setExpenseEditItem(expense)
    setExpenseEditForm({
      amount: expense.amount ?? '',
      category: String(expense.categoryId),
      date: expense.date,
      notes: expense.notes ?? '',
      paymentAccountId: expense.paymentAccountId
        ? String(expense.paymentAccountId)
        : '',
      sourceTransactionId: expense.sourceTransactionId
        ? String(expense.sourceTransactionId)
        : '',
    })
    setExpenseEditStatus('idle')
    setExpenseEditMessage('')
  }

  const submitExpense = async (options: { keepOpen: boolean }) => {
    setExpenseSubmitStatus('loading')
    setExpenseSubmitMessage('')

    if (!expenseForm.amount.trim()) {
      setExpenseSubmitStatus('error')
      setExpenseSubmitMessage('金額を入力してください。')
      return
    }
    if (!expenseForm.category) {
      setExpenseSubmitStatus('error')
      setExpenseSubmitMessage('カテゴリを選択してください。')
      return
    }
    if (!expenseForm.date) {
      setExpenseSubmitStatus('error')
      setExpenseSubmitMessage('日付を入力してください。')
      return
    }

    try {
      const createBody: Record<string, unknown> = {
        amount: expenseForm.amount,
        categoryId: Number(expenseForm.category),
        date: expenseForm.date,
        notes: expenseForm.notes,
      }
      if (expenseForm.paymentAccountId) {
        createBody.paymentAccountId = Number(expenseForm.paymentAccountId)
      }
      const res = await authFetcher('/api/household/expenses/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      })
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '支出の登録に失敗しました。')
      }
      setExpenseSubmitStatus('success')
      setExpenseSubmitMessage('支出を登録しました。')
      if (options.keepOpen) {
        setExpenseForm((prev) => ({ ...prev, amount: '', notes: '' }))
      } else {
        setExpenseForm({
          amount: '',
          category: '',
          date: toLocalDateString(today),
          notes: '',
          paymentAccountId: '',
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['household', 'summary'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'expenses'] })
      if (!options.keepOpen) {
        setTimeout(() => setIsExpenseModalOpen(false), 500)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '支出の登録に失敗しました。'
      setExpenseSubmitStatus('error')
      setExpenseSubmitMessage(message)
    }
  }

  const handleExpenseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitExpense({ keepOpen: false })
  }

  const handleExpenseSubmitAndContinue = async () => {
    await submitExpense({ keepOpen: true })
  }

  const handleExpenseUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!expenseEditItem) return
    setExpenseEditStatus('loading')
    setExpenseEditMessage('')

    if (!expenseEditForm.amount.trim()) {
      setExpenseEditStatus('error')
      setExpenseEditMessage('金額を入力してください。')
      return
    }
    if (!expenseEditForm.category) {
      setExpenseEditStatus('error')
      setExpenseEditMessage('カテゴリを選択してください。')
      return
    }
    if (!expenseEditForm.date) {
      setExpenseEditStatus('error')
      setExpenseEditMessage('日付を入力してください。')
      return
    }

    try {
      const updateBody: Record<string, unknown> = {
        amount: expenseEditForm.amount,
        categoryId: Number(expenseEditForm.category),
        date: expenseEditForm.date,
        notes: expenseEditForm.notes,
        paymentAccountId: expenseEditForm.paymentAccountId
          ? Number(expenseEditForm.paymentAccountId)
          : null,
        sourceTransactionId: expenseEditForm.sourceTransactionId
          ? Number(expenseEditForm.sourceTransactionId)
          : null,
      }
      const res = await authFetcher(`/api/household/expenses/${expenseEditItem.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      })
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '支出の更新に失敗しました。')
      }
      setExpenseEditStatus('success')
      setExpenseEditMessage('支出を更新しました。')
      await queryClient.invalidateQueries({ queryKey: ['household', 'summary'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'expenses'] })
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setTimeout(() => setExpenseEditItem(null), 500)
    } catch (err) {
      const message = err instanceof Error ? err.message : '支出の更新に失敗しました。'
      setExpenseEditStatus('error')
      setExpenseEditMessage(message)
    }
  }

  const handleExpenseDelete = async (expenseId: number) => {
    if (!window.confirm('この支出を削除しますか？')) return
    try {
      const res = await authFetcher(`/api/household/expenses/${expenseId}/`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const parsed = await parseJsonSafely(res)
        throw new Error(parsed?.detail || '支出の削除に失敗しました。')
      }
      setListActionMessage('')
      await queryClient.invalidateQueries({ queryKey: ['household', 'summary'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      await queryClient.invalidateQueries({ queryKey: ['household', 'expenses'] })
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
    } catch (err) {
      const message = err instanceof Error ? err.message : '支出の削除に失敗しました。'
      setListActionMessage(message)
    }
  }

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-5 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <p className="text-[1rem] font-semibold text-[#0d2b32]">支出詳細</p>
            <div className="flex items-center justify-start gap-3 md:justify-center">
              <MonthPicker
                year={targetDate.year}
                month={targetDate.month}
                today={today}
                prevLabel="前月"
                nextLabel="翌月"
                menuAlign="center"
                onChange={(year, month) => setYearMonth(year, month)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
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
            {displayAmount(summaryTotal)}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#5d6a72]">
            <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 font-semibold text-[#0f1c22]">
              先月比 {formatDelta(monthOverMonthChange)}
            </span>
            {summaryStatus === 'error' && (
              <span className="text-[0.7rem] text-[#a33a2b]">
                {summaryError?.message ?? '支出サマリーの取得に失敗しました。'}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <h3 className="text-base font-semibold text-[#0d2b32]">支出の内訳</h3>
          </div>
          {summaryStatus === 'pending' && (
            <p className="text-sm text-[#5d6a72]">支出サマリーを読み込み中...</p>
          )}
          {summaryStatus === 'error' && (
            <p className="text-sm text-[#a33a2b]">
              {summaryError?.message ?? '支出サマリーの取得に失敗しました。'}
            </p>
          )}
          {summaryStatus === 'success' && hasSummaryItems && (
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4">
                <Pie
                  data={summaryChartData}
                  options={{
                    plugins: {
                      legend: {
                        position: 'bottom',
                        labels: {
                          color: '#23323a',
                          font: { size: 12, weight: 'bold' },
                          boxWidth: 12,
                          padding: 12,
                        },
                      },
                      tooltip: {
                        callbacks: {
                          label: (context) => {
                            const label = context.label ?? ''
                            const value = context.raw as number
                            return `${label}: ${displayAmount(value)}`
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
              <div className="flex min-h-full flex-col gap-2 rounded-2xl border border-[#e0e6eb] bg-[#fbfbfc] p-4">
                <div className="text-xs font-semibold text-[#5d6a72]">カテゴリ内訳</div>
                <CategoryBreakdownList
                  items={summaryData?.items ?? []}
                  categories={sortedCategories}
                  formatYen={displayAmount}
                />
              </div>
            </div>
          )}
          {summaryStatus === 'success' && !hasSummaryItems && (
            <p className="text-sm text-[#5d6a72]">今月の支出データがまだありません。</p>
          )}
        </div>

        <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <div>
              <h3 className="text-base font-semibold text-[#0d2b32]">支出推移</h3>
              <p className="text-xs text-[#5d6a72]">
                {targetDate.year}年{targetDate.month}月の{chartTitleLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[0.7rem] font-semibold text-[#5d6a72]" htmlFor="chart-category-filter">
                カテゴリ
              </label>
                <CategoryTreeSelect
                  id="chart-category-filter"
                  className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.7rem] font-semibold text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  categories={sortedCategories}
                  value={chartCategoryFilter}
                  onChange={(next) => setChartCategoryFilter(next)}
                  placeholder="すべて"
                  placeholderValue="all"
                />
            </div>
          </div>
          {(expenseList ?? []).length === 0 && (
            <p className="text-sm text-[#5d6a72]">支出データがまだありません。</p>
          )}
          {(expenseList ?? []).length > 0 && (
            <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4">
              <Bar
                data={dailyStackedData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        color: '#23323a',
                        font: { size: 11, weight: 'bold' },
                        boxWidth: 12,
                        padding: 10,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context) => {
                          const label = context.dataset.label ?? ''
                          const value = context.raw as number
                          return `${label}: ${displayAmount(value)}`
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      stacked: true,
                      ticks: { color: '#5d6a72', maxRotation: 0, autoSkip: true },
                      grid: { display: false },
                    },
                    y: {
                      stacked: true,
                      ticks: { color: '#5d6a72' },
                      grid: { color: '#eef2f5' },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <div>
              <h3 className="text-base font-semibold text-[#0d2b32]">支出一覧</h3>
              <p className="text-xs text-[#5d6a72]">
                {targetDate.year}年{targetDate.month}月
              </p>
            </div>
              <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-2xl border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 text-[0.7rem] font-semibold text-[#0d2b32]">
                {listCategoryLabel}: {displayAmount(isListFiltered ? filteredTotalAmount : totalAmount)}
              </span>
              {isListFiltered && (
                <span className="rounded-2xl border border-[#d7dee4] bg-[#fbfbfc] px-3 py-1 text-[0.7rem] font-semibold text-[#5d6a72]">
                  表示中 {filteredExpenseList.length} / 全 {(expenseList ?? []).length} 件
                </span>
              )}
              <div className="flex items-center gap-2">
                <label className="text-[0.7rem] font-semibold text-[#5d6a72]" htmlFor="expense-category-filter">
                  カテゴリ
                </label>
                <CategoryTreeSelect
                  id="expense-category-filter"
                  className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.7rem] font-semibold text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  categories={sortedCategories}
                  value={listFilters.categoryId}
                  onChange={(next) =>
                    setListFilters((prev) => ({ ...prev, categoryId: next }))
                  }
                  placeholder="すべて"
                  placeholderValue="all"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[0.7rem] font-semibold text-[#5d6a72]" htmlFor="expense-sort-key">
                  並び替え
                </label>
                <select
                  id="expense-sort-key"
                  className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.7rem] font-semibold text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={expenseSortKey}
                  onChange={(event) => setExpenseSortKey(event.target.value as ExpenseSortKey)}
                >
                  <option value="date">日付</option>
                  <option value="amount">金額</option>
                  <option value="category">カテゴリ</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[0.7rem] font-semibold text-[#5d6a72]" htmlFor="expense-sort-direction">
                  順序
                </label>
                <select
                  id="expense-sort-direction"
                  className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.7rem] font-semibold text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={expenseSortDirection}
                  onChange={(event) =>
                    setExpenseSortDirection(event.target.value as SortDirection)
                  }
                >
                  <option value="desc">降順</option>
                  <option value="asc">昇順</option>
                </select>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'primary', size: 'xs', shape: 'pill' })}
                onClick={() => setIsExpenseModalOpen(true)}
              >
                ＋支出
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <span className="text-[0.7rem] font-semibold text-[#5d6a72]">絞り込み</span>
            <TriStateFilterButton
              label="備考"
              value={listFilters.notes}
              onChange={(next) => setListFilters((prev) => ({ ...prev, notes: next }))}
            />
            <TriStateFilterButton
              label="紐付け"
              value={listFilters.link}
              onChange={(next) => setListFilters((prev) => ({ ...prev, link: next }))}
            />
            {isListFiltered && (
              <button
                type="button"
                className={buttonClasses({
                  variant: 'secondary',
                  size: 'xs',
                  shape: 'pill',
                  className: 'text-[#a33a2b]',
                })}
                onClick={clearListFilters}
              >
                絞り込み解除
              </button>
            )}
          </div>
          {categoryStatus === 'error' && (
            <p className="pb-2 text-[0.7rem] text-[#a33a2b]">
              {categoryError?.message ?? 'カテゴリを取得できませんでした。'}
            </p>
          )}
          {expenseListStatus === 'pending' && (
          <p className="text-sm text-[#5d6a72]">支出一覧を読み込み中...</p>
        )}
          {expenseListStatus === 'error' && (
          <p className="text-sm text-[#a33a2b]">
            {expenseListError?.message ?? '支出一覧の取得に失敗しました。'}
          </p>
        )}
          {listActionMessage && (
          <p className="text-sm text-[#a33a2b]">{listActionMessage}</p>
        )}
          {expenseListStatus === 'success' && (expenseList ?? []).length === 0 && (
          <p className="text-sm text-[#5d6a72]">支出がまだ登録されていません。</p>
        )}
          {expenseListStatus === 'success' && (expenseList ?? []).length > 0 && filteredExpenseList.length === 0 && (
          <p className="text-sm text-[#5d6a72]">該当する支出がありません。</p>
        )}
          {expenseListStatus === 'success' && filteredExpenseList.length > 0 && (
          <div className="space-y-2">
            {sortedExpenseList.map((expense) => (
              <div
                key={expense.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e6ebef] bg-[#fbfbfc] px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-[#5d6a72]">{expense.date}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: resolveCategoryColor(
                          expense.categoryName,
                          expense.categoryColor
                        ),
                      }}
                    ></span>
                    <span className="text-sm font-semibold text-[#0f1c22]">
                      {expense.categoryName}
                    </span>
                  </div>
                  {expense.notes && (
                    <span className="text-xs text-[#5d6a72]">{expense.notes}</span>
                  )}
                  {expense.paymentAccountName && (
                    <span className="rounded-full border border-[#d7dee4] bg-[#f0f4f7] px-2 py-0.5 text-[0.65rem] font-semibold text-[#5d6a72]">
                      {PAYMENT_KIND_LABELS[expense.paymentAccountType ?? ''] ?? ''} {expense.paymentAccountName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#0f1c22]">
                    {displayAmount(expense.amount)}
                  </span>
                  <button
                    type="button"
                    className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
                    onClick={() => openExpenseEdit(expense)}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    className={buttonClasses({ variant: 'danger', size: 'xs', shape: 'pill' })}
                    onClick={() => handleExpenseDelete(expense.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {expenseEditItem && (
        <ModalBackdrop
          onClose={() => setExpenseEditItem(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-[#0d2b32]">支出の編集</h4>
                <p className="mt-1 text-xs text-[#5d6a72]">登録済みの支出を更新します。</p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => {
                  setExpenseEditItem(null)
                }}
              >
                閉じる
              </button>
            </div>
            <form className="mt-5 grid gap-3" onSubmit={handleExpenseUpdate}>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-expense-amount">
                  金額
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                    ¥
                  </span>
                  <input
                    id="edit-expense-amount"
                    type="number"
                    inputMode="numeric"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseEditForm.amount}
                    onChange={(event) =>
                      setExpenseEditForm((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-expense-category">
                  カテゴリ
                </label>
                <CategoryTreeSelect
                  id="edit-expense-category"
                  categories={sortedCategories}
                  value={expenseEditForm.category}
                  onChange={(next) =>
                    setExpenseEditForm((prev) => ({ ...prev, category: next }))
                  }
                />
                {categoryStatus === 'error' && (
                  <p className="text-[0.7rem] text-[#a33a2b]">
                    {categoryError?.message ?? 'カテゴリを取得できませんでした。'}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <label
                  className="text-xs font-semibold text-[#0d2b32]"
                  htmlFor="edit-expense-payment-account"
                >
                  支払元 (任意)
                </label>
                <select
                  id="edit-expense-payment-account"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={expenseEditForm.paymentAccountId}
                  onChange={(event) => {
                    const nextPaymentAccountId = event.target.value
                    setExpenseEditForm((prev) => ({
                      ...prev,
                      paymentAccountId: nextPaymentAccountId,
                      sourceTransactionId:
                        prev.paymentAccountId === nextPaymentAccountId
                          ? prev.sourceTransactionId
                          : '',
                    }))
                  }}
                >
                  <option value="">未割当</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      [{PAYMENT_KIND_LABELS[account.kind] ?? account.kind}] {account.name}
                    </option>
                  ))}
                </select>
              </div>
              {expenseEditForm.paymentAccountId && (() => {
                const editAmount = Number(expenseEditForm.amount || 0)
                const allTxs = linkableTxData ?? []
                const currentLinkedId = expenseEditForm.sourceTransactionId
                  ? Number(expenseEditForm.sourceTransactionId)
                  : null
                const linkedTx =
                  allTxs.find((tx) => tx.id === currentLinkedId) ??
                  (expenseEditItem.sourceTransaction &&
                  expenseEditItem.sourceTransactionId === currentLinkedId
                    ? expenseEditItem.sourceTransaction
                    : null)
                const computeRemaining = (tx: LinkableTransaction) => {
                  const txAbs = Math.abs(toNumber(tx.amount))
                  const linked = toNumber(tx.linkedExpenseAmount ?? null)
                  const isCurrentLink = tx.id === currentLinkedId
                  const baseRemaining = Math.max(0, txAbs - linked)
                  return isCurrentLink
                    ? baseRemaining + (Number.isFinite(editAmount) ? editAmount : 0)
                    : baseRemaining
                }
                const minRemaining =
                  Number.isFinite(editAmount) && editAmount > 0 ? editAmount : 0
                const selectableTxs = allTxs
                  .filter((tx) => toNumber(tx.amount) < 0)
                  .filter(
                    (tx) => computeRemaining(tx) + 1e-6 >= minRemaining
                  )
                return (
                  <div className="grid gap-2 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0d2b32]">
                        明細と紐付け (任意)
                      </span>
                      {currentLinkedId && (
                        <button
                          type="button"
                          className="text-[0.7rem] font-semibold text-[#a33a2b]"
                          onClick={() =>
                            setExpenseEditForm((prev) => ({
                              ...prev,
                              sourceTransactionId: '',
                            }))
                          }
                        >
                          解除
                        </button>
                      )}
                    </div>
                    {currentLinkedId && linkedTx ? (
                      <div className="rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-xs text-[#0f1c22]">
                        <div className="font-semibold">
                          {linkedTx.description || '明細'}
                        </div>
                        <div className="text-[#5d6a72]">
                          {linkedTx.date} / {displayAmount(linkedTx.amount)}
                        </div>
                      </div>
                    ) : (
                      <select
                        className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                        value=""
                        onChange={(event) => {
                          if (!event.target.value) return
                          setExpenseEditForm((prev) => ({
                            ...prev,
                            sourceTransactionId: event.target.value,
                          }))
                        }}
                      >
                        <option value="">
                          {selectableTxs.length === 0
                            ? '紐付け可能な明細がありません'
                            : '明細を選択してください'}
                        </option>
                        {selectableTxs.map((tx) => {
                          const remaining = computeRemaining(tx)
                          return (
                            <option key={tx.id} value={tx.id}>
                              {tx.date} / {tx.description || '明細'} / {displayAmount(tx.amount)} (残 {displayAmount(remaining)})
                            </option>
                          )
                        })}
                      </select>
                    )}
                    <p className="text-[0.65rem] text-[#7a8790]">
                      支出日 ({expenseEditForm.date || '未設定'}) と同じ月の明細を表示しています。
                    </p>
                  </div>
                )
              })()}
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-expense-date">
                    日付
                  </label>
                  <input
                    id="edit-expense-date"
                    type="date"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseEditForm.date}
                    onChange={(event) =>
                      setExpenseEditForm((prev) => ({ ...prev, date: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-expense-notes">
                    備考
                  </label>
                  <input
                    id="edit-expense-notes"
                    type="text"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseEditForm.notes}
                    onChange={(event) =>
                      setExpenseEditForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
                  onClick={() =>
                    setExpenseEditForm({
                      amount: expenseEditItem.amount ?? '',
                      category: String(expenseEditItem.categoryId),
                      date: expenseEditItem.date,
                      notes: expenseEditItem.notes ?? '',
                      paymentAccountId: expenseEditItem.paymentAccountId
                        ? String(expenseEditItem.paymentAccountId)
                        : '',
                      sourceTransactionId: expenseEditItem.sourceTransactionId
                        ? String(expenseEditItem.sourceTransactionId)
                        : '',
                    })
                  }
                >
                  リセット
                </button>
                <div className="flex flex-col items-end gap-1 text-right">
                  <button
                    type="submit"
                    disabled={expenseEditStatus === 'loading'}
                    className={buttonClasses({
                      variant: 'primary',
                      size: 'md',
                      shape: 'pill',
                      className:
                        expenseEditStatus === 'loading'
                          ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                          : 'px-5',
                    })}
                  >
                    {expenseEditStatus === 'loading' ? '更新中...' : '更新'}
                  </button>
                  {expenseEditStatus !== 'idle' && (
                    <span
                      className={`text-[0.7rem] ${
                        expenseEditStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                      }`}
                    >
                      {expenseEditMessage}
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {isExpenseModalOpen && (
        <ModalBackdrop
          onClose={() => setIsExpenseModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-[#0d2b32]">支出の追加</h4>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  ここで支出を入力して、登録までの流れを最短化します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => {
                  setIsExpenseModalOpen(false)
                }}
              >
                閉じる
              </button>
            </div>
            <form className="mt-5 grid gap-3" onSubmit={handleExpenseSubmit}>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-amount">
                  金額
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                    ¥
                  </span>
                  <input
                    id="expense-amount"
                    type="number"
                    inputMode="numeric"
                    placeholder="例: 1200"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseForm.amount}
                    onChange={(event) =>
                      setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-category">
                  カテゴリ
                </label>
                <CategoryTreeSelect
                  id="expense-category"
                  categories={sortedCategories}
                  value={expenseForm.category}
                  onChange={(next) =>
                    setExpenseForm((prev) => ({ ...prev, category: next }))
                  }
                />
                {categoryStatus === 'error' && (
                  <p className="text-[0.7rem] text-[#a33a2b]">
                    {categoryError?.message ?? 'カテゴリを取得できませんでした。'}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <label
                  className="text-xs font-semibold text-[#0d2b32]"
                  htmlFor="expense-payment-account"
                >
                  支払元 (任意)
                </label>
                <select
                  id="expense-payment-account"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={expenseForm.paymentAccountId}
                  onChange={(event) =>
                    setExpenseForm((prev) => ({
                      ...prev,
                      paymentAccountId: event.target.value,
                    }))
                  }
                >
                  <option value="">未割当</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      [{PAYMENT_KIND_LABELS[account.kind] ?? account.kind}] {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-date">
                    日付
                  </label>
                  <input
                    id="expense-date"
                    type="date"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseForm.date}
                    onChange={(event) =>
                      setExpenseForm((prev) => ({ ...prev, date: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-notes">
                    備考
                  </label>
                  <input
                    id="expense-notes"
                    type="text"
                    placeholder="例: ランチ"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                    value={expenseForm.notes}
                    onChange={(event) =>
                      setExpenseForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
                  onClick={() =>
                    setExpenseForm({
                      amount: '',
                      category: '',
                      date: toLocalDateString(today),
                      notes: '',
                      paymentAccountId: '',
                    })
                  }
                >
                  クリア
                </button>
                <div className="flex flex-col items-end gap-1 text-right">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={expenseSubmitStatus === 'loading'}
                      className={buttonClasses({
                        variant: 'secondary',
                        size: 'md',
                        shape: 'pill',
                        className:
                          expenseSubmitStatus === 'loading'
                            ? 'border-transparent bg-[#cfd8dd] text-[#60707a]'
                            : '',
                      })}
                      onClick={handleExpenseSubmitAndContinue}
                    >
                      連続追加
                    </button>
                    <button
                      type="submit"
                      disabled={expenseSubmitStatus === 'loading'}
                      className={buttonClasses({
                        variant: 'primary',
                        size: 'md',
                        shape: 'pill',
                        className:
                          expenseSubmitStatus === 'loading'
                            ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                            : 'px-5',
                      })}
                    >
                      {expenseSubmitStatus === 'loading' ? '保存中...' : '保存'}
                    </button>
                  </div>
                  {expenseSubmitStatus !== 'idle' && (
                    <span
                      className={`text-[0.7rem] ${
                        expenseSubmitStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                      }`}
                    >
                      {expenseSubmitMessage}
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </section>
  )
}

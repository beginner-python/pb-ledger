import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import MonthPicker from '../../shared/components/MonthPicker'
import { buttonClasses } from '../../../ui/button'
import { useMonth } from '../../shared/state/MonthContext'
import { toLocalDateString } from '../../shared/utils/date'
import BudgetCreateModal from '../components/BudgetCreateModal'
import BudgetEditModal from '../components/BudgetEditModal'
import BudgetSection from '../components/BudgetSection'
import PeriodTotalEditModal from '../components/PeriodTotalEditModal'
import ExpenseCreateModal from '../components/ExpenseCreateModal'
import ExpenseSummarySection from '../components/ExpenseSummarySection'
import { resolveCategoryColor } from '../utils/categoryColors'
import {
  copyBudget,
  createBudget,
  createExpense,
  deleteBudget,
  fetchBudgetSummary,
  fetchHouseholdCategories,
  fetchHouseholdSummary,
  fetchPaymentAccounts,
  setPeriodTotal,
  updateBudget,
} from '../services/household'
import type {
  BudgetDisplayItem,
  BudgetSummary,
  CreateBudgetInput,
  CreateBudgetVars,
  CreateExpenseInput,
  CreateExpenseVars,
  HouseholdCategoryOption,
  HouseholdSummary,
  UpdateBudgetInput,
} from '../types/householdTypes'

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

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return 0
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return Number.isNaN(num) ? 0 : num
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

function validateExpense(input: CreateExpenseInput): string | null {
  if (!input.amount.trim()) return '金額を入力してください。'
  if (!input.category) return 'カテゴリを入力してください。'
  if (!input.date) return '日付を入力してください。'
  return null
}

function validateBudget(input: CreateBudgetInput): string | null {
  if (!input.category) return 'カテゴリを入力してください。'
  if (!input.amount.trim()) return '予算額を入力してください。'
  return null
}

export default function HouseholdPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [budgetForm, setBudgetForm] = useState({
    category: '',
    amount: '',
    notes: '',
  })
  const [budgetEditItem, setBudgetEditItem] = useState<BudgetDisplayItem | null>(null)
  const [budgetEditForm, setBudgetEditForm] = useState({
    category: '',
    amount: '',
    notes: '',
  })
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    category: '',
    date: toLocalDateString(today),
    notes: '',
    paymentAccountId: '',
  })
  const [budgetValidationMessage, setBudgetValidationMessage] = useState('')
  const [budgetEditMessage, setBudgetEditMessage] = useState('')
  const [expenseValidationMessage, setExpenseValidationMessage] = useState('')

  const createExpenseMutation = useMutation({
    mutationFn: (vars: CreateExpenseVars) => createExpense(vars.input),
    onSuccess: async (_data, vars) => {
      if (vars.keepOpen) {
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

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household', 'summary'] }),
        queryClient.invalidateQueries({ queryKey: ['household', 'budget'] }),
      ])

      if (!vars.keepOpen) {
        window.setTimeout(() => setIsExpenseModalOpen(false), 500)
      }
    }
  })

  const createBudgetMutation = useMutation({
    mutationFn: (vars: CreateBudgetVars) => createBudget(vars.input),
    onSuccess: async (_data, vars) => {
      setBudgetForm({ category: '', amount: '', notes: '' })

      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })

      if (!vars.keepOpen) {
        window.setTimeout(() => setIsBudgetModalOpen(false), 500)
      }
    }
  })

  const updateBudgetMutation = useMutation({
    mutationFn: (vars: UpdateBudgetInput) => updateBudget(vars),
    onSuccess: async () => {
      setBudgetEditMessage("予算を更新しました。")
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      window.setTimeout(() => setBudgetEditItem(null), 500)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '予算の更新に失敗しました。'
      setBudgetEditMessage(message)
    },
  })

  const deleteBudgetMutation = useMutation({
    mutationFn: (allocationId: number) => deleteBudget(allocationId),
    onSuccess: async () => {
      setBudgetCopyMessage(null)
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '予算の削除に失敗しました。'
      setBudgetCopyMessage({ text: message, tone: 'error' })
    },
  })

  const [budgetCopyMessage, setBudgetCopyMessage] = useState<{
    text: string
    tone: 'success' | 'error'
  } | null>(null)

  const [isPeriodTotalModalOpen, setIsPeriodTotalModalOpen] = useState(false)
  const [periodTotalErrorMessage, setPeriodTotalErrorMessage] = useState<string>('')

  const setPeriodTotalMutation = useMutation({
    mutationFn: (amount: number | null) =>
      setPeriodTotal({
        year: targetDate.year,
        month: targetDate.month,
        totalAmount: amount,
      }),
    onSuccess: async () => {
      setPeriodTotalErrorMessage('')
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      setIsPeriodTotalModalOpen(false)
    },
    onError: (err) => {
      setPeriodTotalErrorMessage(
        err instanceof Error ? err.message : '月上限の更新に失敗しました。'
      )
    },
  })

  const copyBudgetMutation = useMutation({
    mutationFn: () => {
      const sourceDate = new Date(targetDate.year, targetDate.month - 2, 1)
      return copyBudget({
        sourceYear: sourceDate.getFullYear(),
        sourceMonth: sourceDate.getMonth() + 1,
        targetYear: targetDate.year,
        targetMonth: targetDate.month,
      })
    },
    onSuccess: async (result) => {
      const skippedSuffix =
        result.skipped > 0 ? `（既存 ${result.skipped} 件はそのまま）` : ''
      let text: string
      if (result.copied > 0 && result.totalAmountCopied) {
        text = `予算 ${result.copied} 件と月の上限をコピーしました${skippedSuffix}。`
      } else if (result.copied > 0) {
        text = `予算 ${result.copied} 件をコピーしました${skippedSuffix}。`
      } else if (result.totalAmountCopied) {
        text = '月の上限をコピーしました。'
      } else {
        text = 'すべて設定済みのためコピー対象がありません。'
      }
      setBudgetCopyMessage({ text, tone: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['household', 'budget'] })
      window.setTimeout(() => setBudgetCopyMessage(null), 5000)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '前月コピーに失敗しました。'
      setBudgetCopyMessage({ text: message, tone: 'error' })
      window.setTimeout(() => setBudgetCopyMessage(null), 5000)
    },
  })

  const submitExpense = (options: { keepOpen: boolean }) => {
    const errorMessage = validateExpense(expenseForm)
    if (errorMessage) {
      setExpenseValidationMessage(errorMessage)
      return
    }
    setExpenseValidationMessage('')

    createExpenseMutation.mutate({
      input: expenseForm,
      keepOpen: options.keepOpen,
    })
  }

  const handleExpenseSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitExpense({ keepOpen: false })
  }

  const handleExpenseSubmitAndContinue = () => {
    submitExpense({ keepOpen: true })
  }

  const submitBudget = (options: { keepOpen: boolean }) => {
    const input: CreateBudgetInput = {
      year: targetDate.year,
      month: targetDate.month,
      category: budgetForm.category,
      amount: budgetForm.amount,
      notes: budgetForm.notes,
    }

    const errorMessage = validateBudget(input)
    if (errorMessage) {
      setBudgetValidationMessage(errorMessage)
      return
    }
    setBudgetValidationMessage('')

    createBudgetMutation.mutate({
      input,
      keepOpen: options.keepOpen,
    })
  }

  const handleBudgetSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitBudget({ keepOpen: false })
  }

  const handleBudgetSubmitAndContinue = () => {
    submitBudget({ keepOpen: true })
  }

  const openBudgetEdit = (item: BudgetDisplayItem) => {
    if (!item.allocationId) return
    setBudgetEditItem(item)
    setBudgetEditForm({
      category: String(item.categoryId),
      amount: item.budget !== null && item.budget !== undefined ? String(item.budget) : '',
      notes: item.notes ?? '',
    })
    setBudgetEditMessage('')
  }

  const handleBudgetUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!budgetEditItem?.allocationId) return

    setBudgetEditMessage('')

    if (!budgetEditForm.category) {
      setBudgetEditMessage('カテゴリを選択してください。')
      return
    }
    if (!budgetEditForm.amount.trim()) {
      setBudgetEditMessage('予算額を入力してください。')
      return
    }

    updateBudgetMutation.mutate({
      allocationId: budgetEditItem.allocationId,
      category: budgetEditForm.category,
      amount: budgetEditForm.amount,
      notes: budgetEditForm.notes,
    })
  }

  const handleBudgetDelete = (item: BudgetDisplayItem) => {
    if (!item.allocationId) return
    if (!window.confirm('この予算を削除しますか？')) return

    deleteBudgetMutation.mutate(item.allocationId)
  }

  const { data, status, error } = useQuery<HouseholdSummary, Error>({
    queryKey: ['household', 'summary', targetDate.year, targetDate.month],
    queryFn: () =>
      fetchHouseholdSummary({
        year: targetDate.year,
        month: targetDate.month,
      }),
    staleTime: 0,
  })

  const previousMonth = useMemo(() => {
    if (targetDate.month === 1) {
      return { year: targetDate.year - 1, month: 12 }
    }
    return { year: targetDate.year, month: targetDate.month - 1 }
  }, [targetDate])

  const { data: previousData } = useQuery<HouseholdSummary, Error>({
    queryKey: ['household', 'summary', previousMonth.year, previousMonth.month],
    queryFn: () =>
      fetchHouseholdSummary({
        year: previousMonth.year,
        month: previousMonth.month,
      }),
    staleTime: 0,
  })

  const {
    data: categoryOptions,
    status: categoryStatus,
    error: categoryError,
  } = useQuery<HouseholdCategoryOption[], Error>({
    queryKey: ['household', 'categories'],
    queryFn: fetchHouseholdCategories,
    staleTime: 0,
  })

  const sortedCategories = useMemo(() => {
    return (categoryOptions ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [categoryOptions])

  const { data: paymentAccountOptions } = useQuery({
    queryKey: ['ledger', 'payment-accounts'],
    queryFn: fetchPaymentAccounts,
    staleTime: 30_000,
  })
  const paymentAccounts = paymentAccountOptions ?? []

  const {
    data: budgetData,
    status: budgetStatus,
    error: budgetError,
  } = useQuery<BudgetSummary, Error>({
    queryKey: ['household', 'budget', targetDate.year, targetDate.month],
    queryFn: () =>
      fetchBudgetSummary({
        year: targetDate.year,
        month: targetDate.month,
      }),
    staleTime: 0,
  })

  const chartData = useMemo(() => {
    const items = data?.items ?? []
    const values = items.map((item) => toNumber(item.total))
    const labels = items.map((item) => item.categoryName)
    const colors = items.map((item) => resolveCategoryColor(item.categoryName, item.categoryColor))
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
  }, [data])

  const budgetItems = useMemo<BudgetDisplayItem[]>(() => {
    const items = budgetData?.items ?? []
    return items.map((item) => {
      const budget = toNumber(item.budget)
      const spent = toNumber(item.spent)
      const remaining = Math.max(budget - spent, 0)
      const usageRate = budget > 0 ? (spent / budget) * 100 : 0
      const overAmount = Math.max(spent - budget, 0)
      const exceeded = spent > budget
      const categoryColor = resolveCategoryColor(item.categoryName, item.categoryColor)
      const atLimit = !exceeded && budget > 0 && spent >= budget
      const warning = !exceeded && !atLimit && usageRate >= 80
      const tone = exceeded
        ? {
          border: 'border-[#f2b4b4]',
          bg: '#fff1f2',
          text: 'text-[#b91c1c]',
          track: '#fee2e2',
          bar: categoryColor,
          badge: 'border-[#f2b4b4] bg-[#fff1f2] text-[#b91c1c]',
          label: '超過',
        }
        : atLimit
          ? {
            border: 'border-[#f8d29b]',
            bg: '#fff7ed',
            text: 'text-[#b45309]',
            track: '#ffedd5',
            bar: categoryColor,
            badge: 'border-[#f8d29b] bg-[#fff7ed] text-[#b45309]',
            label: '上限',
          }
          : warning
            ? {
              border: 'border-[#fde68a]',
              bg: '#fffbeb',
              text: 'text-[#a16207]',
              track: '#fef3c7',
              bar: categoryColor,
              badge: 'border-[#fde68a] bg-[#fffbeb] text-[#a16207]',
              label: '注意',
            }
            : {
              border: 'border-[#e6ebef]',
              bg: '#fbfbfc',
              text: 'text-[#0d2b32]',
              track: '#e9edf1',
              bar: categoryColor,
              badge: 'border-[#d7dee4] bg-white text-[#0f1c22]',
              label: '通常',
            }
      return {
        ...item,
        budget,
        spent,
        ownSpent: toNumber(item.ownSpent ?? null),
        childrenSpent: toNumber(item.childrenSpent ?? null),
        childrenWithBudgetSpent: toNumber(item.childrenWithBudgetSpent ?? null),
        childrenWithoutBudgetSpent: toNumber(item.childrenWithoutBudgetSpent ?? null),
        remaining,
        usageRate,
        overAmount,
        exceeded,
        atLimit,
        warning,
        tone,
        color: categoryColor,
      }
    })
  }, [budgetData])

  const budgetCategoryIds = useMemo(() => {
    return new Set(
      budgetItems
        .map((item) => item.categoryId)
        .filter((categoryId) => categoryId && categoryId > 0)
    )
  }, [budgetItems])

  // 支出はあるが当月予算未設定のカテゴリ。降順で並べる。
  // 親に予算が付いている子は rollup で吸収されているため除外する。
  const unbudgetedSpendingItems = useMemo(() => {
    const items = data?.items ?? []
    return items
      .filter((item) => {
        if (budgetCategoryIds.has(item.categoryId)) return false
        if (
          item.parentCategoryId !== null &&
          budgetCategoryIds.has(item.parentCategoryId)
        ) {
          return false
        }
        return true
      })
      .map((item) => ({
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        categoryColor: item.categoryColor,
        spent: toNumber(item.total),
      }))
      .filter((item) => item.spent > 0)
      .sort((a, b) => b.spent - a.spent)
  }, [data, budgetCategoryIds])

  const handleAddBudgetForCategory = (categoryId: number) => {
    setBudgetForm({ category: String(categoryId), amount: '', notes: '' })
    setIsBudgetModalOpen(true)
  }

  const availableBudgetCategories = useMemo(() => {
    return sortedCategories.filter((category) => !budgetCategoryIds.has(category.id))
  }, [sortedCategories, budgetCategoryIds])

  const totalAmount = data?.total ?? null
  const previousTotalAmount = previousData?.total ?? null
  const monthOverMonthChange =
    totalAmount !== null && previousTotalAmount !== null
      ? toNumber(totalAmount) - toNumber(previousTotalAmount)
      : null
  const hasItems = (data?.items ?? []).length > 0
  const budgetTotal = budgetData?.totalBudget ?? null
  const budgetSpent = budgetData?.totalSpent ?? null
  const hasBudgets = (budgetData?.items ?? []).length > 0
  const budgetTotalValue = toNumber(budgetTotal)
  const budgetSpentValue = toNumber(budgetSpent)
  const budgetUsageRate =
    budgetTotalValue > 0 ? (budgetSpentValue / budgetTotalValue) * 100 : 0
  const totalExceeded = budgetSpentValue > budgetTotalValue
  const totalAtLimit = !totalExceeded && budgetTotalValue > 0 && budgetSpentValue >= budgetTotalValue
  const totalWarning = !totalExceeded && !totalAtLimit && budgetUsageRate >= 80
  const totalTone = totalExceeded
    ? {
      border: 'border-[#f2b4b4]',
      bg: '#fff1f2',
      text: 'text-[#b91c1c]',
      track: '#fee2e2',
      bar: '#1f927f',
      badge: 'border-[#f2b4b4] bg-[#fff1f2] text-[#b91c1c]',
      label: '超過',
    }
    : totalAtLimit
      ? {
        border: 'border-[#f8d29b]',
        bg: '#fff7ed',
        text: 'text-[#b45309]',
        track: '#ffedd5',
        bar: '#1f927f',
        badge: 'border-[#f8d29b] bg-[#fff7ed] text-[#b45309]',
        label: '上限',
      }
      : totalWarning
        ? {
          border: 'border-[#fde68a]',
          bg: '#fffbeb',
          text: 'text-[#a16207]',
          track: '#fef3c7',
          bar: '#1f927f',
          badge: 'border-[#fde68a] bg-[#fffbeb] text-[#a16207]',
          label: '注意',
        }
        : {
          border: 'border-[#e6ebef]',
          bg: '#fbfbfc',
          text: 'text-[#0d2b32]',
          track: '#e9edf1',
          bar: '#1f927f',
          badge: 'border-[#d7dee4] bg-white text-[#0f1c22]',
          label: '通常',
        }

  return (
    <section className="flex min-h-[360px] w-full flex-col gap-5 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <p className="text-[1rem] font-semibold text-[#0d2b32]">支出</p>
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
          {displayAmount(totalAmount)}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#5d6a72]">
          <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 font-semibold text-[#0f1c22]">
            先月比 {formatDelta(monthOverMonthChange)}
          </span>
          {status === 'error' && (
            <span className="text-[0.7rem] text-[#a33a2b]">
              {error?.message ?? '合計支出の取得に失敗しました。'}
            </span>
          )}
        </div>
      </div>

      <BudgetSection
        budgetStatus={budgetStatus}
        budgetErrorMessage={budgetError?.message}
        hasBudgets={hasBudgets}
        budgetItems={budgetItems}
        budgetTotalValue={budgetTotalValue}
        budgetSpentValue={budgetSpentValue}
        budgetTotal={budgetTotal}
        budgetSpent={budgetSpent}
        budgetUsageRate={budgetUsageRate}
        totalExceeded={totalExceeded}
        totalTone={totalTone}
        onOpenCreateBudget={() => setIsBudgetModalOpen(true)}
        onCopyFromPreviousMonth={() => copyBudgetMutation.mutate()}
        isCopying={copyBudgetMutation.isPending}
        copyMessage={budgetCopyMessage?.text}
        copyMessageTone={budgetCopyMessage?.tone}
        periodTotalAmount={
          budgetData?.periodTotalAmount !== undefined &&
          budgetData?.periodTotalAmount !== null
            ? toNumber(budgetData.periodTotalAmount)
            : null
        }
        periodTotalSpent={toNumber(budgetData?.periodTotalSpent ?? null)}
        onEditPeriodTotal={() => {
          setPeriodTotalErrorMessage('')
          setIsPeriodTotalModalOpen(true)
        }}
        unbudgetedItems={unbudgetedSpendingItems}
        onAddBudgetForCategory={handleAddBudgetForCategory}
        onEditBudget={openBudgetEdit}
        onDeleteBudget={handleBudgetDelete}
        formatYen={displayAmount}
      />

      <PeriodTotalEditModal
        isOpen={isPeriodTotalModalOpen}
        onClose={() => setIsPeriodTotalModalOpen(false)}
        targetDate={targetDate}
        initialAmount={
          budgetData?.periodTotalAmount !== undefined &&
          budgetData?.periodTotalAmount !== null
            ? toNumber(budgetData.periodTotalAmount)
            : null
        }
        onSubmit={(amount) => setPeriodTotalMutation.mutate(amount)}
        isSubmitting={setPeriodTotalMutation.isPending}
        errorMessage={periodTotalErrorMessage}
      />

      <BudgetCreateModal
        isOpen={isBudgetModalOpen}
        onClose={() => setIsBudgetModalOpen(false)}
        targetDate={targetDate}
        budgetForm={budgetForm}
        setBudgetForm={setBudgetForm}
        availableBudgetCategories={availableBudgetCategories}
        categoryStatus={categoryStatus}
        categoryErrorMessage={categoryError?.message}
        onSubmit={handleBudgetSubmit}
        onSubmitAndContinue={handleBudgetSubmitAndContinue}
        onClear={() =>
          setBudgetForm({
            category: '',
            amount: '',
            notes: '',
          })
        }
        isSubmitting={createBudgetMutation.isPending}
        validationMessage={budgetValidationMessage}
        submitErrorMessage={
          createBudgetMutation.isError
            ? createBudgetMutation.error instanceof Error
              ? createBudgetMutation.error.message
              : '予算の登録に失敗しました。'
            : undefined
        }
        submitSuccess={createBudgetMutation.isSuccess}
      />

      <BudgetEditModal
        item={budgetEditItem}
        onClose={() => setBudgetEditItem(null)}
        budgetEditForm={budgetEditForm}
        setBudgetEditForm={setBudgetEditForm}
        sortedCategories={sortedCategories}
        categoryStatus={categoryStatus}
        categoryErrorMessage={categoryError?.message}
        onSubmit={handleBudgetUpdate}
        onReset={() => {
          if (!budgetEditItem) return
          setBudgetEditForm({
            category: String(budgetEditItem.categoryId),
            amount:
              budgetEditItem.budget !== null && budgetEditItem.budget !== undefined
                ? String(budgetEditItem.budget)
                : '',
            notes: budgetEditItem.notes ?? '',
          })
        }}
        isSubmitting={updateBudgetMutation.isPending}
        statusMessage={budgetEditMessage}
        submitErrorMessage={
          updateBudgetMutation.isError
            ? updateBudgetMutation.error instanceof Error
              ? updateBudgetMutation.error.message
              : '予算の更新に失敗しました。'
            : undefined
        }
        submitSuccess={updateBudgetMutation.isSuccess}
      />

      <ExpenseCreateModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        expenseForm={expenseForm}
        setExpenseForm={setExpenseForm}
        sortedCategories={sortedCategories}
        categoryStatus={categoryStatus}
        categoryErrorMessage={categoryError?.message}
        onSubmit={handleExpenseSubmit}
        onSubmitAndContinue={handleExpenseSubmitAndContinue}
        onClear={() =>
          setExpenseForm({
            amount: '',
            category: '',
            date: toLocalDateString(today),
            notes: '',
            paymentAccountId: '',
          })
        }
        isSubmitting={createExpenseMutation.isPending}
        paymentAccounts={paymentAccounts}
        validationMessage={expenseValidationMessage}
        submitErrorMessage={
          createExpenseMutation.isError
            ? createExpenseMutation.error instanceof Error
              ? createExpenseMutation.error.message
              : '支出の登録に失敗しました。'
            : undefined
        }
        submitSuccess={createExpenseMutation.isSuccess}
      />

      <ExpenseSummarySection
        status={status}
        errorMessage={error?.message}
        hasItems={hasItems}
        items={data?.items ?? []}
        categories={sortedCategories}
        totalAmount={totalAmount}
        chartData={chartData}
        onOpenExpenseModal={() => setIsExpenseModalOpen(true)}
        onNavigateExpenseDetail={() =>
          navigate('/household/expenses')
        }
        formatYen={displayAmount}
      />

      <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#0d2b32]">年次レポート</h3>
            <p className="mt-1 text-xs text-[#5d6a72]">一年間の出費傾向をまとめて確認</p>
          </div>
          <button
            type="button"
            className={buttonClasses({
              variant: 'secondary',
              size: 'xs',
              shape: 'pill',
              className: 'px-3',
            })}
            onClick={() => navigate('/household/annual')}
          >
            年次レポートを見る
          </button>
        </div>
      </div>

    </section>
  )
}

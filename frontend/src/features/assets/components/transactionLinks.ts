import type { AccountTransaction } from '../types/types'

/** 明細に紐付け可能な未割当の支出 (一覧表示とプルダウン用) */
export type LinkableExpense = {
  id: number
  date: string
  amount: string | null
  notes: string
  categoryName: string
  paymentAccountId: number | null
}

/** 明細に紐付いている支出 (編集・削除用) */
export type LinkedExpense = {
  id: number
  date: string
  amount: string | null
  notes: string
  categoryId: number
  categoryName: string
  categoryColor: string | null
  paymentAccountId: number | null
  sourceTransactionId: number | null
}

export type TxCapacity = {
  txAmountAbs: number
  linkedAmount: number
  remaining: number
  linkedCount: number
  isFullyAllocated: boolean
  isPartiallyAllocated: boolean
}

export const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return Number.isNaN(num) ? null : num
}

/** 明細金額のうち、支出としてまだ登録されていない残額を求める */
export const getTxCapacity = (tx: AccountTransaction): TxCapacity => {
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

/** 明細の残額以下の金額を持つ支出だけを紐付け候補にする */
export const filterLinkableExpenses = (expenses: LinkableExpense[], remaining: number) =>
  expenses.filter((expense) => {
    const amount = Number(expense.amount ?? 0)
    return Number.isFinite(amount) && amount > 0 && amount <= remaining + 1e-6
  })

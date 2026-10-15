import { describe, expect, it } from 'vitest'
import type { AccountTransaction } from '../types/types'
import { filterLinkableExpenses, getTxCapacity, toNumber } from './transactionLinks'

const tx = (overrides: Partial<AccountTransaction>): AccountTransaction => ({
  id: 1,
  date: '2026-10-08',
  description: 'ドラッグストア',
  amount: '-2211.00',
  balance: null,
  notes: '',
  ...overrides,
})

describe('toNumber', () => {
  it('カンマ区切りの文字列と数値を受け付け、不正値は null にする', () => {
    expect(toNumber('1,234.5')).toBe(1234.5)
    expect(toNumber(10)).toBe(10)
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(null)).toBeNull()
  })
})

describe('getTxCapacity', () => {
  it('未紐付けの出金明細は全額が残額になる', () => {
    const cap = getTxCapacity(tx({ amount: '-2211.00' }))
    expect(cap).toMatchObject({ txAmountAbs: 2211, linkedAmount: 0, remaining: 2211 })
    expect(cap.isFullyAllocated).toBe(false)
    expect(cap.isPartiallyAllocated).toBe(false)
  })

  it('一部だけ支出に紐付いた明細は残額と件数を返す', () => {
    const cap = getTxCapacity(tx({ amount: '-5000', linkedExpenseAmount: '1800', linkedExpenseCount: 2 }))
    expect(cap.remaining).toBe(3200)
    expect(cap.linkedCount).toBe(2)
    expect(cap.isPartiallyAllocated).toBe(true)
  })

  it('全額紐付け済みなら残額 0 で isFullyAllocated になる', () => {
    const cap = getTxCapacity(tx({ amount: '-5000', linkedExpenseAmount: '5000.00' }))
    expect(cap.remaining).toBe(0)
    expect(cap.isFullyAllocated).toBe(true)
  })
})

describe('filterLinkableExpenses', () => {
  const expenses = [
    { id: 1, date: '2026-10-01', amount: '1000', notes: '', categoryName: '食費', paymentAccountId: 4 },
    { id: 2, date: '2026-10-02', amount: '3000', notes: '', categoryName: '日用品', paymentAccountId: null },
    { id: 3, date: '2026-10-03', amount: null, notes: '', categoryName: '交通', paymentAccountId: 4 },
  ]

  it('明細の残額以下で金額のある支出だけを残す', () => {
    expect(filterLinkableExpenses(expenses, 2000).map((e) => e.id)).toEqual([1])
    expect(filterLinkableExpenses(expenses, 3000).map((e) => e.id)).toEqual([1, 2])
    expect(filterLinkableExpenses(expenses, 0)).toEqual([])
  })
})

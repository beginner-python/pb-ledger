import { authFetcher } from '../../../api/client'
import type {
  BudgetSummary,
  CreateBudgetInput,
  CreateCategoryInput,
  CreateExpenseInput,
  HouseholdCategoryOption,
  HouseholdSummary,
  PaymentAccountOption,
  UpdateBudgetInput,
  UpdateCategoryInput,
} from '../types/householdTypes'

type HouseholdPeriod = {
  year: number
  month: number
}

export async function createExpense(input: CreateExpenseInput) {
  const body: Record<string, unknown> = {
    amount: input.amount,
    categoryId: Number(input.category),
    date: input.date,
    notes: input.notes,
  }
  if (input.paymentAccountId) {
    body.paymentAccountId = Number(input.paymentAccountId)
  }
  const res = await authFetcher('/api/household/expenses/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to create expense')
  }

  return await res.json()
}

export async function fetchPaymentAccounts(): Promise<PaymentAccountOption[]> {
  const res = await authFetcher('/api/ledger/payment-accounts/')
  if (!res.ok) {
    throw new Error('failed to fetch payment accounts')
  }
  const data = (await res.json()) as { accounts?: PaymentAccountOption[] }
  return data.accounts ?? []
}

export async function createBudget(input: CreateBudgetInput) {
  const res = await authFetcher('/api/household/budgets/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year: input.year,
      month: input.month,
      categoryId: Number(input.category),
      amount: input.amount,
      notes: input.notes,
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.detail || '予算の登録に失敗しました。')
  }

  return await res.json()
}

export async function updateBudget(input: UpdateBudgetInput) {
  const res = await authFetcher(`/api/household/budgets/${input.allocationId}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      categoryId: Number(input.category),
      amount: input.amount,
      notes: input.notes,
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.detail || '予算の更新に失敗しました。')
  }

  return await res.json()
}

export type CopyBudgetInput = {
  sourceYear: number
  sourceMonth: number
  targetYear: number
  targetMonth: number
}

export type CopyBudgetResult = {
  copied: number
  skipped: number
  targetPeriodId: number
  totalAmountCopied: boolean
}

export type SetPeriodTotalInput = {
  year: number
  month: number
  totalAmount: number | null
}

export async function setPeriodTotal(input: SetPeriodTotalInput) {
  const res = await authFetcher('/api/household/budgets/period/total/', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year: input.year,
      month: input.month,
      totalAmount: input.totalAmount,
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '月上限の更新に失敗しました。')
  }

  return await res.json()
}

export async function copyBudget(input: CopyBudgetInput): Promise<CopyBudgetResult> {
  const res = await authFetcher('/api/household/budgets/copy/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceYear: input.sourceYear,
      sourceMonth: input.sourceMonth,
      targetYear: input.targetYear,
      targetMonth: input.targetMonth,
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || '予算のコピーに失敗しました。')
  }

  return (await res.json()) as CopyBudgetResult
}

export async function deleteBudget(allocationId: number) {
  const res = await authFetcher(`/api/household/budgets/${allocationId}/`, {
    method: 'DELETE',
  })

  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to delete budget')
  }

  return null
}

export async function fetchHouseholdSummary({ year, month }: HouseholdPeriod) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
  })
  const res = await authFetcher(`/api/household/expenses/summary/?${params.toString()}`)
  
  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to fetch summary')
  }
  return await res.json() as HouseholdSummary
}

export async function fetchHouseholdCategories() {
  const res = await authFetcher('/api/household/categories/')
  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to fetch categoriess')
  }

  return await res.json() as HouseholdCategoryOption[]
}

export async function fetchBudgetSummary({ year, month }: HouseholdPeriod) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
  })
  const res = await authFetcher(`/api/household/budgets/summary/?${params.toString()}`)
  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to fetch budget summary')
  }
  return await res.json() as BudgetSummary
}

export async function createCategory(input: CreateCategoryInput) {
  const res = await authFetcher('/api/household/categories/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      color: input.color,
      parentId: input.parentId,
      notes: input.notes,
    }),
  })

  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to create category')
  }

  return await res.json()
}

export async function updateCategory(input: UpdateCategoryInput) {
  const res = await authFetcher(`/api/household/categories/${input.id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      color: input.color,
      notes: input.notes,
      parentId: input.parentId,
    }),
  })

  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error('failed to update category')
  }

  return await res.json()
}

export async function deleteCategory(id: number) {
  const res = await authFetcher(`/api/household/categories/${id}/`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'カテゴリの削除に失敗しました。')
  }

  return await res.json().catch(() => null)
}

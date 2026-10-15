import { authFetcher } from '../../../api/client'

export type CashAdjustmentDirection = 'in' | 'out'
export type CashAdjustmentCategory =
  | 'allowance'
  | 'gift'
  | 'repayment'
  | 'other'

export const CASH_ADJUSTMENT_CATEGORY_LABELS: Record<
  CashAdjustmentCategory,
  string
> = {
  allowance: 'お小遣い',
  gift: '贈与・ご祝儀',
  repayment: '立替精算',
  other: 'その他',
}

export type CashAdjustment = {
  id: number
  paymentAccountId: number
  date: string
  direction: CashAdjustmentDirection
  amount: string
  category: CashAdjustmentCategory
  counterpartyName: string
  notes: string
}

async function parseJsonSafely(res: Response) {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

export type CashHistoryEntry = {
  kind: 'transfer_in' | 'transfer_out' | 'expense' | 'adjustment'
  id: number
  date: string
  amountSigned: string
  label: string
  notes: string
  otherAccountId?: number
  otherAccountName?: string
  categoryName?: string
  category?: CashAdjustmentCategory
  direction?: CashAdjustmentDirection
  counterpartyName?: string
  linkedExpenseAmount?: string
  linkedExpenseCount?: number
}

export async function fetchCashHistory(
  accountId: number,
  month: string
): Promise<CashHistoryEntry[]> {
  const params = new URLSearchParams({ month })
  const res = await authFetcher(
    `/api/ledger/accounts/${accountId}/cash-history/?${params.toString()}`
  )
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '現金履歴の取得に失敗しました。')
  }
  return (data.entries ?? []) as CashHistoryEntry[]
}

export type CashAdjustmentInput = {
  paymentAccountId: number
  date: string
  direction: CashAdjustmentDirection
  amount: string
  notes: string
  category?: CashAdjustmentCategory
  counterpartyName?: string
}

export async function createCashAdjustment(
  input: CashAdjustmentInput
): Promise<CashAdjustment> {
  const body: Record<string, unknown> = {
    paymentAccountId: input.paymentAccountId,
    date: input.date,
    direction: input.direction,
    amount: input.amount,
    notes: input.notes,
  }
  if (input.category !== undefined) body.category = input.category
  if (input.counterpartyName !== undefined)
    body.counterpartyName = input.counterpartyName
  const res = await authFetcher('/api/ledger/cash-adjustments/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '現金の入出の登録に失敗しました。')
  }
  return data as CashAdjustment
}

export async function updateCashAdjustment(
  id: number,
  input: Partial<CashAdjustmentInput>
): Promise<CashAdjustment> {
  const body: Record<string, unknown> = {}
  if (input.date !== undefined) body.date = input.date
  if (input.direction !== undefined) body.direction = input.direction
  if (input.amount !== undefined) body.amount = input.amount
  if (input.category !== undefined) body.category = input.category
  if (input.counterpartyName !== undefined)
    body.counterpartyName = input.counterpartyName
  if (input.notes !== undefined) body.notes = input.notes
  const res = await authFetcher(`/api/ledger/cash-adjustments/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '現金の入出の更新に失敗しました。')
  }
  return data as CashAdjustment
}

export async function deleteCashAdjustment(id: number): Promise<void> {
  const res = await authFetcher(`/api/ledger/cash-adjustments/${id}/`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await parseJsonSafely(res)
    throw new Error(data?.error || '現金の入出の削除に失敗しました。')
  }
}

import { authFetcher } from '../../../api/client'
import type { Transfer, TransferFormInput } from '../types/transferTypes'

async function parseJsonSafely(res: Response) {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

export async function createTransfer(
  input: TransferFormInput & {
    fromTransactionId?: string
    toTransactionId?: string
  }
): Promise<Transfer> {
  const body: Record<string, unknown> = {
    date: input.date,
    amount: input.amount,
    fromAccountId: Number(input.fromAccountId),
    toAccountId: Number(input.toAccountId),
    notes: input.notes,
  }
  if (input.fromTransactionId) body.fromTransactionId = Number(input.fromTransactionId)
  if (input.toTransactionId) body.toTransactionId = Number(input.toTransactionId)

  const res = await authFetcher('/api/ledger/transfers/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '振替の登録に失敗しました。')
  }
  return data as Transfer
}

export type AccountTransactionLite = {
  id: number
  date: string
  description: string
  amount: string
  balance: string
}

export async function fetchAccountTransactions(
  accountId: number | string,
  month: string
): Promise<AccountTransactionLite[]> {
  const params = new URLSearchParams({ month, limit: '200' })
  const res = await authFetcher(
    `/api/ledger/accounts/${accountId}/transactions/?${params.toString()}`
  )
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '取引取得に失敗しました。')
  }
  return (data.transactions ?? []) as AccountTransactionLite[]
}

export async function updateTransfer(
  id: number,
  input: {
    date?: string
    amount?: string
    notes?: string
    fromAccountId?: number
    toAccountId?: number
    fromTransactionId?: number | null
    toTransactionId?: number | null
  }
): Promise<Transfer> {
  const res = await authFetcher(`/api/ledger/transfers/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '振替の更新に失敗しました。')
  }
  return data as Transfer
}

export async function deleteTransfer(id: number): Promise<void> {
  const res = await authFetcher(`/api/ledger/transfers/${id}/`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await parseJsonSafely(res)
    throw new Error(data?.error || '振替の削除に失敗しました。')
  }
}

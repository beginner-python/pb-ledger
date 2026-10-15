import { authFetcher } from '../../../api/client'
import type { AccountTransaction } from '../types/types'

async function parseJsonSafely(res: Response) {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

/**
 * 口座の月次明細を、振替・支出の紐付け情報込みで取得する。
 * （transfers 側の fetchAccountTransactions は紐付け情報を落とすため別途用意）
 */
export async function fetchAccountTransactions(
  accountId: number | string,
  month: string
): Promise<AccountTransaction[]> {
  const params = new URLSearchParams({ month, limit: '200' })
  const res = await authFetcher(
    `/api/ledger/accounts/${accountId}/transactions/?${params.toString()}`
  )
  const data = await parseJsonSafely(res)
  if (!res.ok) {
    throw new Error(data?.error || '取引取得に失敗しました。')
  }
  return (data.transactions ?? []) as AccountTransaction[]
}

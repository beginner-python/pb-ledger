import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { setupServer } from 'msw/node'
import { handlers } from '../../../mocks/handlers'
import recordedJson from '../../../mocks/fixtures/recorded.json'
import { useAuthStore } from '../../../authStore'
import { MonthProvider } from '../../shared/state/MonthContext'
import BalancePage from './BalancePage'

// 公開デモと同じ記録済み応答で、資産管理ページが集計を表示できることを確かめる。
const recorded = recordedJson as {
  anchorMonth: string
  responses: Record<string, { status: number; body: unknown }>
}
const server = setupServer(...handlers)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  // 記録時の基準月から表示を始める (MonthProvider が参照する)
  vi.stubEnv('VITE_DEMO_ANCHOR_MONTH', recorded.anchorMonth)
  useAuthStore.setState({ accessToken: 'demo-access-token', isHydrating: false })
})

const renderPage = (initialEntry = '/balance') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MonthProvider>
          <BalancePage />
        </MonthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('BalancePage (記録済みデータ)', () => {
  it('総資産と口座ごとの残高を表示する', async () => {
    renderPage()
    const assets = recorded.responses[`GET /api/ledger/assets/?month=${recorded.anchorMonth}`].body as {
      totalAssets: string
      bankAccounts: Array<{ accountName: string }>
    }
    expect(await screen.findByText('総資産')).toBeInTheDocument()
    // 通貨記号は環境のロケールで半角/全角が変わるので数字部分だけを見る
    const total = Math.round(Number(assets.totalAssets)).toLocaleString('en-US')
    await waitFor(() => expect(document.body.textContent).toContain(total))
    for (const account of assets.bankAccounts) {
      expect(screen.getByText(account.accountName)).toBeInTheDocument()
    }
  })

  it('口座を選ぶと明細一覧を表示する', async () => {
    const transactions = recorded.responses[
      `GET /api/ledger/accounts/1/transactions/?limit=200&month=${recorded.anchorMonth}`
    ].body as { transactions: Array<{ description: string }> }
    renderPage('/balance?account=1&assetKind=bank_account')
    expect(await screen.findByText('入出金履歴')).toBeInTheDocument()
    expect(await screen.findByText(transactions.transactions[0].description)).toBeInTheDocument()
  })
})

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { AccountTransaction, AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'
import { fetchHouseholdCategories } from '../../household/services/household'
import DropdownMenu from '../../shared/components/DropdownMenu'
import type { DropdownMenuItem } from '../../shared/components/DropdownMenu'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import CashHistoryPanel from './CashHistoryPanel'
import CsvTemplatePanel from './CsvTemplatePanel'
import ExpenseFromTxModal from './ExpenseFromTxModal'
import LinkExpenseModal from './LinkExpenseModal'
import LinkedExpensesModal from './LinkedExpensesModal'
import ReferenceUrlPanel from './ReferenceUrlPanel'
import TxRowActions from './TxRowActions'
import TxTransferActions from './TxTransferActions'
import { getTxCapacity, toNumber } from './transactionLinks'
import type { LinkableExpense } from './transactionLinks'

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
  const [showFormatPanel, setShowFormatPanel] = useState<boolean>(false)
  // テンプレートを保存した直後、口座一覧の再取得が終わるまでの間もメニュー表記を「編集」にする
  const [templateSaved, setTemplateSaved] = useState<boolean>(false)
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
  const [expenseTxItem, setExpenseTxItem] = useState<AccountTransaction | null>(null)
  const [linkTxItem, setLinkTxItem] = useState<AccountTransaction | null>(null)
  const [viewLinkedTxItem, setViewLinkedTxItem] = useState<AccountTransaction | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ['household', 'categories'],
    queryFn: fetchHouseholdCategories,
    staleTime: 30_000,
    enabled: supportsTransactions,
  })


  const openExpenseFromTx = (tx: AccountTransaction) => {
    if (getTxCapacity(tx).isFullyAllocated) return
    setExpenseTxItem(tx)
  }

  const openLinkExpenseFromTx = (tx: AccountTransaction) => {
    if (getTxCapacity(tx).isFullyAllocated) return
    setLinkTxItem(tx)
  }

  const openViewLinkedExpenses = (tx: AccountTransaction) => setViewLinkedTxItem(tx)

  // 表示中の取引はすべて同月なので、最初の取引の日付から月を導出する。
  // この月の「未紐付け支出」を一度だけ取得し、紐付けボタンの有効化判定と
  // モーダル内のプルダウンの両方で同じキャッシュを共有する。
  const linkableMonth = transactions[0]?.date.slice(0, 7) ?? ''
  const linkableExpensesQuery = useQuery<LinkableExpense[], Error>({
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


  const referenceUrlSavedValue = selectedAccount.referenceUrl ?? ''
  const hasTemplate =
    supportsCsv && (Boolean(selectedAccount.hasCsvTemplate) || templateSaved)

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
                  onSelect: () => setShowFormatPanel(true),
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
        <CsvTemplatePanel
          account={selectedAccount}
          onSaved={async () => {
            setTemplateSaved(true)
            setShowFormatPanel(false)
            await onFormatSaved()
          }}
        />
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
        <ExpenseFromTxModal
          tx={expenseTxItem}
          account={selectedAccount}
          categories={categoriesQuery.data ?? []}
          displayAmount={displayAmount}
          onClose={() => setExpenseTxItem(null)}
        />
      )}

      {linkTxItem && (
        <LinkExpenseModal
          tx={linkTxItem}
          account={selectedAccount}
          displayAmount={displayAmount}
          linkableExpenses={linkableExpensesQuery.data ?? []}
          isLoadingExpenses={linkableExpensesQuery.isLoading}
          expensesError={linkableExpensesQuery.error ?? null}
          onClose={() => setLinkTxItem(null)}
        />
      )}

      {viewLinkedTxItem && (
        <LinkedExpensesModal
          tx={viewLinkedTxItem}
          categories={categoriesQuery.data ?? []}
          displayAmount={displayAmount}
          onClose={() => setViewLinkedTxItem(null)}
        />
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
                <ReferenceUrlPanel
                  key={`${selectedAccount.assetKind}:${selectedAccount.accountId}:${selectedAccount.referenceUrl ?? ''}`}
                  account={selectedAccount}
                  supportsCsv={supportsCsv}
                  statusClassName={statusClassName}
                  onSaved={onFormatSaved}
                />
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  )
}

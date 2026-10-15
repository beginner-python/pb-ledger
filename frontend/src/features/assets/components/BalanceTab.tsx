import type { ReactNode } from 'react'

import AccountDetail from './AccountDetail'
import AssetSection from './AssetSection'
import type {
  AssetKind,
  AccountTransaction,
  AssetAccount,
  BalanceResult,
  MonthlySummaryAccount,
  MonthlySummaryResult,
} from '../types/types'
import MonthPicker from '../../shared/components/MonthPicker'
import { buttonClasses } from '../../../ui/button'

type BalanceTabProps = {
  balanceStatus: 'idle' | 'loading' | 'success' | 'error'
  balanceMessage: string
  balanceResult: BalanceResult | null
  bankAccounts: AssetAccount[]
  cashWallets: AssetAccount[]
  financialAssets: AssetAccount[]
  monthlyStatus: 'idle' | 'loading' | 'success' | 'error'
  monthlyMessage: string
  monthlySummary: MonthlySummaryResult | null
  selectedMonthlySummary: MonthlySummaryAccount | null
  selectedMonth: string
  monthPickerYear: number
  monthPickerMonth: number
  today: Date
  onMonthChange: (year: number, month: number) => void
  displayAmount: (value: number | string | null | undefined) => string
  showAmounts: boolean
  onToggleShowAmounts: () => void
  selectedAccount: AssetAccount | null
  detailResetKey: number
  onSelectAccount: (account: AssetAccount) => void
  onClearSelection: () => void
  onAddAccount: (assetKind: AssetKind) => void
  transactionStatus: 'idle' | 'loading' | 'success' | 'error'
  transactionMessage: string
  transactions: AccountTransaction[]
  onDeleteAccount: (account: AssetAccount) => Promise<void>
  onFormatSaved: () => Promise<void>
  deleteStatus: 'idle' | 'loading' | 'error'
  deleteMessage: string
  importPanel?: ReactNode
  snapshotPanel?: ReactNode
  snapshotHistoryPanel?: ReactNode
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

export default function BalanceTab({
  balanceStatus,
  balanceMessage,
  balanceResult,
  bankAccounts,
  cashWallets,
  financialAssets,
  monthlyStatus,
  monthlyMessage,
  monthlySummary,
  selectedMonthlySummary,
  selectedMonth,
  monthPickerYear,
  monthPickerMonth,
  today,
  onMonthChange,
  displayAmount,
  showAmounts,
  onToggleShowAmounts,
  selectedAccount,
  detailResetKey,
  onSelectAccount,
  onClearSelection,
  onAddAccount,
  transactionStatus,
  transactionMessage,
  transactions,
  onDeleteAccount,
  onFormatSaved,
  deleteStatus,
  deleteMessage,
  importPanel,
  snapshotPanel,
  snapshotHistoryPanel,
  statusClassName,
}: BalanceTabProps) {
  // 収入・支出の月次集計は銀行口座でのみ意味を持つ
  // （クレカ / 現金 / 金融資産では non-bank の明細が混在 or 不在のため数値は出さない）
  const showIncomeExpense =
    !selectedAccount || selectedAccount.assetKind === 'bank_account'
  const income =
    selectedAccount && selectedMonthlySummary
      ? selectedMonthlySummary.income
      : monthlySummary?.totalIncome
  const expense =
    selectedAccount && selectedMonthlySummary
      ? selectedMonthlySummary.expense
      : monthlySummary?.totalExpense
  const totalAssetsChange = balanceResult?.totalAssetsChange
  const selectedAccountChange =
    selectedAccount?.balanceChange ??
    (selectedAccount?.balance !== null &&
    selectedAccount?.balance !== undefined &&
    selectedAccount?.previousBalance !== null &&
    selectedAccount?.previousBalance !== undefined
      ? Number(selectedAccount.balance) - Number(selectedAccount.previousBalance)
      : null)
  const previousMonthEnd = balanceResult?.previousMonthEnd
  const formatDelta = (value: number | string | null | undefined) => {
    if (!showAmounts) return '******'
    if (value === null || value === undefined) return '¥-'
    const num = typeof value === 'string' ? Number(value.toString().replace(/,/g, '')) : value
    if (Number.isNaN(num)) return '¥-'
    const sign = num > 0 ? '+' : num < 0 ? '-' : ''
    return `${sign}${displayAmount(Math.abs(num))}`
  }
  const showMonthlyCards = monthlyStatus !== 'loading' || Boolean(monthlySummary)
  return (
    <section className="flex min-h-[360px] w-full flex-col gap-5 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <p className="text-[1rem] font-semibold text-[#0d2b32]">
            {selectedAccount ? selectedAccount.accountName : '総資産'}
          </p>
          <div className="flex items-center justify-start gap-3 md:justify-center">
            <MonthPicker
              year={monthPickerYear}
              month={monthPickerMonth}
              today={today}
              onChange={onMonthChange}
              menuAlign="center"
            />
          </div>
          <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
            {selectedAccount && (
              <button
                type="button"
                onClick={onClearSelection}
                className={buttonClasses({
                  variant: 'primary',
                  size: 'lg',
                  shape: 'rounded',
                  className: 'w-[140px] text-sm font-bold',
                })}
              >
                一覧に戻る
              </button>
            )}
            <button
              type="button"
              className={buttonClasses({
                variant: 'primary',
                size: 'lg',
                shape: 'rounded',
                className: 'w-[140px] text-sm font-bold',
              })}
              onClick={onToggleShowAmounts}
            >
              {showAmounts ? '金額を非表示' : '金額を表示'}
            </button>
          </div>
        </div>
        <p className="text-[2rem] font-extrabold text-[#145e52]">
          {displayAmount(
            selectedAccount ? selectedAccount.balance : balanceResult?.totalAssets
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#5d6a72]">
          <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 font-semibold text-[#0f1c22]">
            先月比 {formatDelta(selectedAccount ? selectedAccountChange : totalAssetsChange)}
          </span>
          {previousMonthEnd && (
            <span className="text-[0.7rem] text-[#7a8790]">
              比較対象: {previousMonthEnd}
            </span>
          )}
        </div>
        {showIncomeExpense && (
          <>
            {monthlyStatus === 'error' && monthlyMessage ? (
              <div className={`rounded-[10px] px-3 py-2 text-sm ${statusClassName('error')}`}>
                {monthlyMessage}
              </div>
            ) : showMonthlyCards ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[10px] border border-[#d7dee4] bg-[#f7f9fb] px-3 py-2">
                  <p className="text-xs font-semibold text-[#5d6a72]">収入</p>
                  <p className="text-base font-bold text-[#167353]">
                    {displayAmount(income)}
                  </p>
                </div>
                <div className="rounded-[10px] border border-[#d7dee4] bg-[#f7f9fb] px-3 py-2">
                  <p className="text-xs font-semibold text-[#5d6a72]">支出</p>
                  <p className="text-base font-bold text-[#b23b3b]">
                    {displayAmount(expense)}
                  </p>
                </div>
              </div>
            ) : null}
            {monthlyStatus === 'loading' && (
              <div className={`rounded-[10px] px-3 py-2 text-sm ${statusClassName('loading')}`}>
                収入・支出を集計しています...
              </div>
            )}
          </>
        )}
      </div>

      {balanceStatus === 'error' && balanceMessage && (
        <div
          className={`mt-2 rounded-[10px] px-4 py-3 text-sm backdrop-blur-sm ${statusClassName(
            'error'
          )}`}
        >
          {balanceMessage}
        </div>
      )}

      {balanceStatus === 'success' && balanceResult && (
        <>
          {selectedAccount ? (
            <AccountDetail
              key={`${selectedAccount.assetKind}:${selectedAccount.accountId}:${detailResetKey}`}
              selectedAccount={selectedAccount}
              selectedMonth={selectedMonth}
              displayAmount={displayAmount}
              importPanel={importPanel}
              snapshotPanel={snapshotPanel}
              snapshotHistoryPanel={snapshotHistoryPanel}
              transactionStatus={transactionStatus}
              transactionMessage={transactionMessage}
              transactions={transactions}
              onDeleteAccount={onDeleteAccount}
              onFormatSaved={onFormatSaved}
              deleteStatus={deleteStatus}
              deleteMessage={deleteMessage}
              statusClassName={statusClassName}
            />
          ) : (
            <div className="grid gap-4">
              <AssetSection
                title="銀行口座"
                total={balanceResult.bankAccountsTotal}
                totalChange={balanceResult.bankAccountsTotalChange}
                accounts={bankAccounts}
                addLabel="銀行口座を追加"
                emptyText="銀行口座がまだ登録されていません。"
                displayAmount={displayAmount}
                formatDelta={formatDelta}
                onSelectAccount={onSelectAccount}
                onAddAccount={() => onAddAccount('bank_account')}
              />
              <AssetSection
                title="現金"
                total={balanceResult.cashWalletsTotal}
                totalChange={balanceResult.cashWalletsTotalChange}
                accounts={cashWallets}
                addLabel="現金を追加"
                emptyText="現金（財布）がまだ登録されていません。"
                displayAmount={displayAmount}
                formatDelta={formatDelta}
                onSelectAccount={onSelectAccount}
                onAddAccount={() => onAddAccount('cash')}
              />
              <AssetSection
                title="金融資産"
                total={balanceResult.financialAssetsTotal}
                totalChange={balanceResult.financialAssetsTotalChange}
                accounts={financialAssets}
                addLabel="金融資産を追加"
                emptyText="金融資産がまだ登録されていません。"
                displayAmount={displayAmount}
                formatDelta={formatDelta}
                onSelectAccount={onSelectAccount}
                onAddAccount={() => onAddAccount('financial_asset')}
              />
            </div>
          )}
        </>
      )}

      {balanceStatus === 'loading' && (
        <div
          className={`mt-2 rounded-[10px] px-4 py-3 text-sm backdrop-blur-sm ${statusClassName(
            'loading'
          )}`}
        >
          資産を取得しています...
        </div>
      )}
    </section>
  )
}

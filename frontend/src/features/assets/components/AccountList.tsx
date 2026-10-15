import { ASSET_KIND_LABELS } from '../types/types'
import type { AssetAccount } from '../types/types'

type AccountListProps = {
  accounts: AssetAccount[]
  displayAmount: (value: number | string | null | undefined) => string
  onSelectAccount: (account: AssetAccount) => void
  onAddAccount: () => void
  addLabel: string
  emptyText: string
  hideBalance?: boolean
}

export default function AccountList({
  accounts,
  displayAmount,
  onSelectAccount,
  onAddAccount,
  addLabel,
  emptyText,
  hideBalance = false,
}: AccountListProps) {
  const hasAccounts = accounts.length > 0
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 lg:grid-cols-4">
      {accounts.map((account) => {
        const label = ASSET_KIND_LABELS[account.assetKind]
        return (
          <button
            type="button"
            key={`${account.assetKind}:${account.accountId}`}
            onClick={() => onSelectAccount(account)}
            aria-label={`${account.accountName} の詳細を表示`}
            className={`grid min-h-[148px] gap-1.5 rounded-[14px] border border-[#0f3b70] bg-[linear-gradient(130deg,rgba(255,255,255,0.08),rgba(255,255,255,0)_40%),linear-gradient(155deg,#2e7fc8_0%,#1f5fa5_55%,#0f3b70_100%)] p-4 text-left text-[#f4f9ff] shadow-[0_12px_30px_rgba(15,59,112,0.28)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,59,112,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6fffb]`}
          >
            <div className="flex flex-col gap-1">
              <span className="inline-flex w-fit items-center rounded-full border border-[rgba(255,255,255,0.35)] bg-[rgba(255,255,255,0.12)] px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[#f1f6ff]">
                {label}
              </span>
              <span className="text-lg font-bold text-[#e8f2ff]">
                {account.accountName}
              </span>
            </div>
            {!hideBalance && (
              <p className="mt-1 text-2xl font-extrabold text-white">
                {displayAmount(account.balance)}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-[#d8e6ff]">
                更新: {account.lastUpdated ? account.lastUpdated : '未設定'}
              </span>
              <span className="rounded-full border border-[rgba(255,255,255,0.35)] bg-[rgba(255,255,255,0.12)] px-2.5 py-1 text-[0.8rem] text-[#f1f6ff]">
                {account.source}
              </span>
            </div>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onAddAccount}
        className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#9bb6ff] bg-[#f4f7ff] p-4 text-center text-[#1c3f8a] transition duration-150 hover:-translate-y-0.5 hover:border-[#1c3f8a]"
      >
        <span className="text-sm font-semibold">{addLabel}</span>
        <span className="text-xs text-[#5d6a72]">
          {hasAccounts ? '資産を追加します。' : emptyText}
        </span>
      </button>
    </div>
  )
}

import AccountList from './AccountList'
import type { AssetAccount } from '../types/types'

type AssetSectionProps = {
  title: string
  total?: string | number | null | undefined
  totalChange?: string | number | null | undefined
  accounts: AssetAccount[]
  addLabel: string
  emptyText: string
  displayAmount: (value: number | string | null | undefined) => string
  formatDelta?: (value: number | string | null | undefined) => string
  onSelectAccount: (account: AssetAccount) => void
  onAddAccount: () => void
  showHeader?: boolean
  hideBalance?: boolean
}

export default function AssetSection({
  title,
  total,
  totalChange,
  accounts,
  addLabel,
  emptyText,
  displayAmount,
  formatDelta,
  onSelectAccount,
  onAddAccount,
  showHeader = true,
  hideBalance = false,
}: AssetSectionProps) {
  return (
    <section className="rounded-[18px] border border-[#d7dee4] bg-[#f7f9fb] p-4">
      {showHeader && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#0d2b32]">{title}</p>
            <p className="mt-1 text-2xl font-extrabold text-[#145e52]">
              {displayAmount(total)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5d6a72]">
            <span className="rounded-full border border-[#d7dee4] bg-white px-3 py-1 font-semibold text-[#0f1c22]">
              先月比 {formatDelta ? formatDelta(totalChange) : '-'}
            </span>
          </div>
        </div>
      )}
      <AccountList
        accounts={accounts}
        displayAmount={displayAmount}
        onSelectAccount={onSelectAccount}
        onAddAccount={onAddAccount}
        addLabel={addLabel}
        emptyText={emptyText}
        hideBalance={hideBalance}
      />
    </section>
  )
}

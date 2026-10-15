import { buttonClasses } from '../../../ui/button'
import DropdownMenu from '../../shared/components/DropdownMenu'
import type { DropdownMenuItem } from '../../shared/components/DropdownMenu'
import type { TxTransferTriggerState } from './TxTransferActions'

type TxCapacity = {
  txAmountAbs: number
  linkedAmount: number
  remaining: number
  linkedCount: number
  isFullyAllocated: boolean
  isPartiallyAllocated: boolean
}

type Props = {
  capacity: TxCapacity
  canConvertToExpense: boolean
  hasLinkableExpense: boolean
  transfer: TxTransferTriggerState
  onOpenExpense: () => void
  onOpenLinkExpense: () => void
  onOpenViewLinked: () => void
}

export default function TxRowActions({
  capacity,
  canConvertToExpense,
  hasLinkableExpense,
  transfer,
  onOpenExpense,
  onOpenLinkExpense,
  onOpenViewLinked,
}: Props) {
  // 振替済みの場合: バッジ自体をクリックで編集モーダルへ
  if (transfer.isLinked) {
    return (
      <button
        type="button"
        className="inline-flex items-center rounded-full border border-[#157665] bg-[#eaf5ef] px-3 py-1 text-[11px] font-bold text-[#0e4f2c] transition hover:-translate-y-0.5 hover:shadow-[0_6px_14px_rgba(14,79,44,0.2)]"
        title="振替を編集"
        onClick={transfer.openEdit}
      >
        振替済
      </button>
    )
  }

  // 支出が全額紐付け済み: バッジのみ (クリックで確認/編集)
  if (capacity.isFullyAllocated) {
    return (
      <button
        type="button"
        className="inline-flex items-center rounded-full border border-[#86d19b] bg-[#e6f4ec] px-3 py-1 text-[11px] font-bold text-[#0e4f2c] transition hover:-translate-y-0.5 hover:shadow-[0_6px_14px_rgba(14,79,44,0.2)]"
        title="登録済みの支出を確認/編集"
        onClick={onOpenViewLinked}
      >
        支出済
        {capacity.linkedCount > 1 && (
          <span className="ml-1 text-[10px] text-[#0e4f2c]">
            ({capacity.linkedCount}件)
          </span>
        )}
      </button>
    )
  }

  // メニュー項目を組み立て (出金=支出系 / 銀行口座=振替系)
  const items: DropdownMenuItem[] = []
  if (canConvertToExpense) {
    items.push({
      key: 'expense',
      label: capacity.isPartiallyAllocated ? '残りを支出にする' : '支出にする',
      onSelect: onOpenExpense,
    })
    items.push({
      key: 'link-expense',
      label: '既存の支出と紐付け',
      disabled: !hasLinkableExpense,
      title: hasLinkableExpense
        ? undefined
        : '金額が条件に合う未紐付け支出がありません (同月・同口座/未割当・残額以下)',
      onSelect: onOpenLinkExpense,
    })
  }
  if (transfer.isBank && !transfer.isExpenseLinked) {
    items.push({
      key: 'create-transfer',
      label: transfer.direction === 'out' ? '別口座へ移動' : '別口座から入金',
      onSelect: transfer.openCreate,
    })
  }

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {capacity.isPartiallyAllocated && (
        <button
          type="button"
          className="inline-flex items-center rounded-full border border-[#86d19b] bg-[#e6f4ec] px-3 py-1 text-[11px] font-bold text-[#0e4f2c] transition hover:-translate-y-0.5 hover:shadow-[0_6px_14px_rgba(14,79,44,0.2)]"
          title="登録済みの支出を確認/編集"
          onClick={onOpenViewLinked}
        >
          支出 ¥{capacity.linkedAmount.toLocaleString()}
          {capacity.linkedCount > 1 && (
            <span className="ml-1 text-[10px] text-[#0e4f2c]">
              ({capacity.linkedCount}件)
            </span>
          )}
        </button>
      )}
      <DropdownMenu
        items={items}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className={buttonClasses({
              variant: open ? 'ghost' : 'secondary',
              size: 'xs',
              shape: 'pill',
            })}
          >
            {capacity.isPartiallyAllocated ? '追加' : '紐付け'}
            <span aria-hidden className="ml-1 text-[9px]">
              ▾
            </span>
          </button>
        )}
      />
    </div>
  )
}

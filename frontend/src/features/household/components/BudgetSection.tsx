import type { ReactNode } from 'react'
import type { BudgetDisplayItem } from '../types/householdTypes'
import { buttonClasses } from '../../../ui/button'
import { resolveCategoryColor } from '../utils/categoryColors'

export type UnbudgetedSpendingItem = {
  categoryId: number
  categoryName: string
  categoryColor: string | null
  spent: number
}

type BudgetCardProps = {
  item: BudgetDisplayItem
  formatYen: (value: number | string | null | undefined) => string
  onEdit: (item: BudgetDisplayItem) => void
  onDelete: (item: BudgetDisplayItem) => void
  nested?: boolean
  children?: ReactNode
}

function BudgetCard({
  item,
  formatYen,
  onEdit,
  onDelete,
  nested,
  children,
}: BudgetCardProps) {
  const cardPadding = nested ? 'px-3 py-2' : 'px-4 py-3'
  const barHeight = nested ? 'h-2' : 'h-3'
  const dotSize = nested ? 'h-2.5 w-2.5' : 'h-3 w-3'
  const titleSize = nested ? 'text-xs' : 'text-sm'
  const radius = nested ? 'rounded-xl' : 'rounded-2xl'
  return (
    <div
      className={`relative border ${radius} ${cardPadding} ${item.exceeded ? 'pl-5' : ''} ${item.tone.border}`}
      style={{ backgroundColor: item.tone.bg }}
    >
      {(item.exceeded || item.atLimit) && (
        <span
          className={`absolute inset-y-2 left-0 w-1.5 rounded-r-full ${
            item.exceeded ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'
          }`}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full ${dotSize}`}
            style={{ backgroundColor: item.color }}
          ></span>
          <span className={`font-semibold text-[#0f1c22] ${titleSize}`}>
            {item.categoryName}
          </span>
          {item.allocationId && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={buttonClasses({
                  variant: 'secondary',
                  size: 'xs',
                  shape: 'pill',
                  className: 'py-0.5',
                })}
                onClick={() => onEdit(item)}
              >
                編集
              </button>
              <button
                type="button"
                className={buttonClasses({
                  variant: 'danger',
                  size: 'xs',
                  shape: 'pill',
                  className: 'py-0.5',
                })}
                onClick={() => onDelete(item)}
              >
                削除
              </button>
            </div>
          )}
        </div>
        <div className={`text-xs font-semibold ${item.tone.text}`}>
          使用率: {item.usageRate.toFixed(1)}%
          <span
            className={`ml-2 rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold ${item.tone.badge}`}
          >
            {item.tone.label}
          </span>
        </div>
      </div>
      <div
        className={`mt-2 w-full overflow-hidden rounded-full ${barHeight}`}
        style={{ backgroundColor: item.tone.track }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.min(item.usageRate, 100)}%`,
            backgroundColor: item.tone.bar,
          }}
        ></div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-semibold text-[#5d6a72]">
        <span>予算: {formatYen(item.budget)}</span>
        <span>使用済み: {formatYen(item.spent)}</span>
        {item.exceeded ? (
          <span className="text-[#c0262d]">超過額: {formatYen(item.overAmount)}</span>
        ) : (
          <span className="text-[#0f1c22]">
            残り使用可能: {formatYen(item.remaining)}
          </span>
        )}
      </div>
      {item.isParent && (
        <div className="mt-1 flex flex-wrap gap-3 text-[0.7rem] text-[#5d6a72]">
          <span>内訳 / 自カテゴリ: {formatYen(item.ownSpent)}</span>
          <span>親予算で管理: {formatYen(item.childrenWithoutBudgetSpent)}</span>
          <span>個別予算で管理: {formatYen(item.childrenWithBudgetSpent)}</span>
        </div>
      )}
      {children}
    </div>
  )
}

type Tone = {
  border: string
  bg: string
  text: string
  track: string
  bar: string
  badge: string
  label: string
}

type Props = {
  budgetStatus: 'pending' | 'error' | 'success'
  budgetErrorMessage?: string
  hasBudgets: boolean
  budgetItems: BudgetDisplayItem[]
  budgetTotalValue: number
  budgetSpentValue: number
  budgetTotal: string | null
  budgetSpent: string | null
  budgetUsageRate: number
  totalExceeded: boolean
  totalTone: Tone
  onOpenCreateBudget: () => void
  onCopyFromPreviousMonth: () => void
  isCopying: boolean
  copyMessage?: string
  copyMessageTone?: 'success' | 'error'
  periodTotalAmount: number | null
  periodTotalSpent: number
  onEditPeriodTotal: () => void
  unbudgetedItems: UnbudgetedSpendingItem[]
  onAddBudgetForCategory: (categoryId: number) => void
  onEditBudget: (item: BudgetDisplayItem) => void
  onDeleteBudget: (item: BudgetDisplayItem) => void
  formatYen: (value: number | string | null | undefined) => string
}

export default function BudgetSection({
  budgetStatus,
  budgetErrorMessage,
  hasBudgets,
  budgetItems,
  budgetTotalValue,
  budgetSpentValue,
  budgetTotal,
  budgetSpent,
  budgetUsageRate,
  totalExceeded,
  totalTone,
  onOpenCreateBudget,
  onCopyFromPreviousMonth,
  isCopying,
  copyMessage,
  copyMessageTone,
  periodTotalAmount,
  periodTotalSpent,
  onEditPeriodTotal,
  unbudgetedItems,
  onAddBudgetForCategory,
  onEditBudget,
  onDeleteBudget,
  formatYen,
}: Props) {
  const hasPeriodTotal = periodTotalAmount !== null && periodTotalAmount > 0
  const periodTotalUsageRate = hasPeriodTotal
    ? Math.min((periodTotalSpent / (periodTotalAmount as number)) * 100, 999)
    : 0
  const periodTotalExceeded = hasPeriodTotal && periodTotalSpent > (periodTotalAmount as number)
  const periodTotalRemaining = hasPeriodTotal
    ? (periodTotalAmount as number) - periodTotalSpent
    : 0
  return (
    <div className="w-full">
      <div className="w-full rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <h3 className="text-base font-semibold text-[#0d2b32]">予算の使用状況</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClasses({ variant: 'primary', size: 'xs', shape: 'pill' })}
                onClick={onOpenCreateBudget}
              >
                ＋予算
              </button>
              <button
                type="button"
                className={buttonClasses({
                  variant: 'secondary',
                  size: 'xs',
                  shape: 'pill',
                  className: isCopying
                    ? 'border-transparent bg-[#cfd8dd] text-[#60707a]'
                    : '',
                })}
                onClick={onCopyFromPreviousMonth}
                disabled={isCopying}
              >
                {isCopying ? 'コピー中...' : '前月コピー'}
              </button>
              {copyMessage && (
                <span
                  className={`text-[0.7rem] ${
                    copyMessageTone === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                  }`}
                >
                  {copyMessage}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold text-[#0d2b32]">
            <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1.5">
              使用済み: {formatYen(budgetSpent)}
            </span>
            <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1.5">
              残り使用可能: {formatYen(Math.max(budgetTotalValue - budgetSpentValue, 0))}
            </span>
          </div>
        </div>
        <div className="mb-4 rounded-2xl border border-[#d7dee4] bg-[#f7f9fb] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-0.5 text-[0.65rem] font-semibold text-[#0f1c22]">
                月の上限
              </span>
              {hasPeriodTotal && (
                <span
                  className={`text-xs font-semibold ${
                    periodTotalExceeded ? 'text-[#b91c1c]' : 'text-[#0d2b32]'
                  }`}
                >
                  使用率: {periodTotalUsageRate.toFixed(1)}%
                </span>
              )}
              {!hasPeriodTotal && (
                <span className="text-xs text-[#5d6a72]">未設定</span>
              )}
            </div>
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
              onClick={onEditPeriodTotal}
            >
              {hasPeriodTotal ? '編集' : '設定'}
            </button>
          </div>
          {hasPeriodTotal && (
            <>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: periodTotalExceeded ? '#fee2e2' : '#e9edf1' }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${Math.min(periodTotalUsageRate, 100)}%`,
                    backgroundColor: periodTotalExceeded ? '#ef4444' : '#157665',
                  }}
                ></div>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-semibold text-[#5d6a72]">
                <span>上限: {formatYen(periodTotalAmount)}</span>
                <span>月の支出合計: {formatYen(periodTotalSpent)}</span>
                {periodTotalExceeded ? (
                  <span className="text-[#b91c1c]">
                    超過額: {formatYen(periodTotalSpent - (periodTotalAmount as number))}
                  </span>
                ) : (
                  <span className="text-[#0f1c22]">
                    残り: {formatYen(periodTotalRemaining)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {budgetTotalValue > 0 && (
          <div
            className={`mb-4 rounded-2xl border px-4 py-3 ${totalTone.border}`}
            style={{ backgroundColor: totalTone.bg }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-0.5 text-[0.65rem] font-semibold text-[#0f1c22]">
                  カテゴリ予算合計
                </span>
              </div>
              <div className={`text-xs font-semibold ${totalTone.text}`}>
                使用率: {budgetUsageRate.toFixed(1)}%
                <span
                  className={`ml-2 rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold ${totalTone.badge}`}
                >
                  {totalTone.label}
                </span>
              </div>
            </div>
            <div
              className="mt-2 h-3 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: totalTone.track }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.min(budgetUsageRate, 100)}%`,
                  backgroundColor: totalTone.bar,
                }}
              ></div>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-semibold text-[#5d6a72]">
              <span>予算: {formatYen(budgetTotal)}</span>
              <span>使用済み: {formatYen(budgetSpent)}</span>
              {totalExceeded ? (
                <span className={totalTone.text}>
                  超過額: {formatYen(budgetSpentValue - budgetTotalValue)}
                </span>
              ) : (
                <span className="text-[#0f1c22]">
                  残り使用可能: {formatYen(budgetTotalValue - budgetSpentValue)}
                </span>
              )}
            </div>
          </div>
        )}

        {budgetStatus === 'pending' && (
          <p className="text-sm text-[#5d6a72]">予算データを読み込み中...</p>
        )}
        {budgetStatus === 'error' && (
          <p className="text-sm text-[#a33a2b]">
            {budgetErrorMessage ?? '予算データの取得に失敗しました。'}
          </p>
        )}
        {budgetStatus === 'success' && !hasBudgets && (
          <p className="text-sm text-[#5d6a72]">この月の予算がまだ登録されていません。</p>
        )}
        {budgetStatus === 'success' && hasBudgets && (
          <div className="space-y-4">
            {(() => {
              // 予算が付いているカテゴリ ID の集合。子を親にネストするかの判定に使う。
              const budgetedIds = new Set(budgetItems.map((b) => b.categoryId))
              const childrenByParent = new Map<number, BudgetDisplayItem[]>()
              const topLevelItems: BudgetDisplayItem[] = []
              for (const item of budgetItems) {
                if (
                  item.parentCategoryId !== null &&
                  budgetedIds.has(item.parentCategoryId)
                ) {
                  const list = childrenByParent.get(item.parentCategoryId) ?? []
                  list.push(item)
                  childrenByParent.set(item.parentCategoryId, list)
                } else {
                  topLevelItems.push(item)
                }
              }

              return topLevelItems.map((item) => {
                const children = childrenByParent.get(item.categoryId) ?? []
                return (
                  <BudgetCard
                    key={item.categoryId}
                    item={item}
                    formatYen={formatYen}
                    onEdit={onEditBudget}
                    onDelete={onDeleteBudget}
                  >
                    {children.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-[#e6ebef] pt-3">
                        {children.map((child) => (
                          <BudgetCard
                            key={child.categoryId}
                            item={child}
                            formatYen={formatYen}
                            onEdit={onEditBudget}
                            onDelete={onDeleteBudget}
                            nested
                          />
                        ))}
                      </div>
                    )}
                  </BudgetCard>
                )
              })
            })()}
          </div>
        )}

        {budgetStatus === 'success' && unbudgetedItems.length > 0 && (
          <div
            className={`rounded-2xl border border-dashed border-[#d7dee4] bg-[#fbfbfc] p-3 ${
              hasBudgets ? 'mt-4' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="text-xs font-semibold text-[#0d2b32]">
                予算未設定（支出あり {unbudgetedItems.length} 件）
              </span>
              <span className="text-[0.7rem] text-[#5d6a72]">
                合計 {formatYen(unbudgetedItems.reduce((sum, item) => sum + item.spent, 0))}
              </span>
            </div>
            <div className="space-y-1">
              {unbudgetedItems.map((item) => (
                <div
                  key={item.categoryId}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#e6ebef] bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: resolveCategoryColor(
                          item.categoryName,
                          item.categoryColor
                        ),
                      }}
                    ></span>
                    <span className="text-xs font-semibold text-[#0f1c22]">
                      {item.categoryName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#0f1c22]">
                      {formatYen(item.spent)}
                    </span>
                    <button
                      type="button"
                      className={buttonClasses({
                        variant: 'secondary',
                        size: 'xs',
                        shape: 'pill',
                      })}
                      onClick={() => onAddBudgetForCategory(item.categoryId)}
                    >
                      予算を設定
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

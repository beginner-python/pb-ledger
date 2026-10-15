import type { ChartData } from 'chart.js'
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js'
import { Pie } from 'react-chartjs-2'
import type {
  HouseholdCategoryOption,
  HouseholdSummaryItem,
} from '../types/householdTypes'
import { buttonClasses } from '../../../ui/button'
import CategoryBreakdownList from './CategoryBreakdownList'

ChartJS.register(ArcElement, Tooltip, Legend)

type Props = {
  status: 'pending' | 'error' | 'success'
  errorMessage?: string
  hasItems: boolean
  items: HouseholdSummaryItem[]
  categories: HouseholdCategoryOption[]
  totalAmount: string | null
  chartData: ChartData<'pie', number[], string>
  onOpenExpenseModal: () => void
  onNavigateExpenseDetail: () => void
  formatYen: (value: number | string | null | undefined) => string
}

export default function ExpenseSummarySection({
  status,
  errorMessage,
  hasItems,
  items,
  categories,
  totalAmount,
  chartData,
  onOpenExpenseModal,
  onNavigateExpenseDetail,
  formatYen,
}: Props) {
  if (status === 'pending') {
    return <p className="text-sm text-[#5d6a72]">読み込み中...</p>
  }

  if (status === 'error') {
    return <p className="text-sm text-[#a33a2b]">{errorMessage ?? '取得に失敗しました。'}</p>
  }

  return (
    <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <h3 className="text-base font-semibold text-[#0d2b32]">支出の内訳</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
            onClick={onNavigateExpenseDetail}
          >
            支出詳細
          </button>
          <div className="rounded-2xl border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1.5 text-xs font-semibold text-[#0d2b32]">
            支出合計: {formatYen(totalAmount)}
          </div>
        </div>
      </div>
      {hasItems ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4">
            <Pie
              data={chartData}
              options={{
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: {
                      color: '#23323a',
                      font: { size: 12, weight: 'bold' },
                      boxWidth: 12,
                      padding: 12,
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        const label = context.label ?? ''
                        const value = context.raw as number
                        return `${label}: ${formatYen(value)}`
                      },
                    },
                  },
                },
              }}
            />
          </div>
          <div className="flex min-h-full flex-col gap-2 rounded-2xl border border-[#e0e6eb] bg-[#fbfbfc] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#5d6a72]">カテゴリ内訳</span>
              <button
                type="button"
                className={buttonClasses({ variant: 'primary', size: 'xs', shape: 'pill' })}
                onClick={onOpenExpenseModal}
              >
                ＋支出
              </button>
            </div>
            <CategoryBreakdownList
              items={items}
              categories={categories}
              formatYen={formatYen}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e6eb] bg-[#fbfbfc] p-4">
          <p className="text-sm text-[#5d6a72]">今月の支出データがまだありません。</p>
          <button
            type="button"
            className={buttonClasses({ variant: 'primary', size: 'xs', shape: 'pill' })}
            onClick={onOpenExpenseModal}
          >
            ＋支出
          </button>
        </div>
      )}
    </div>
  )
}

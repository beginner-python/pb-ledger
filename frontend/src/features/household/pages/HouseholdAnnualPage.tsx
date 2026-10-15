import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, Pie } from 'react-chartjs-2'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'

import { authFetcher } from '../../../api/client'
import { buttonClasses } from '../../../ui/button'
import { resolveCategoryColor } from '../utils/categoryColors'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
)

type HouseholdSummaryItem = {
  categoryId: number
  categoryName: string
  categoryColor: string | null
  parentCategoryId: number | null
  total: string | null
}

type HouseholdSummary = {
  year: number
  month: number
  total: string | null
  items: HouseholdSummaryItem[]
}

type CategorySeries = {
  name: string
  color: string
  values: number[]
  total: number
}

const yenFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const formatYen = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '¥-'
  return yenFormatter.format(value)
}

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return 0
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return Number.isNaN(num) ? 0 : num
}

const parseJsonSafely = async (res: Response) => {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1}月`)

const fetchAnnualSummaries = async (year: number) => {
  const months = Array.from({ length: 12 }, (_, index) => index + 1)
  const results = await Promise.all(
    months.map(async (month) => {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      const res = await authFetcher(`/api/household/expenses/summary/?${params.toString()}`)
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '年次サマリーの取得に失敗しました。')
      }
      return parsed as HouseholdSummary
    })
  )
  return results
}

export default function HouseholdAnnualPage() {
  const today = useMemo(() => new Date(), [])
  const navigate = useNavigate()
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())

  const {
    data: availableYears,
  } = useQuery<number[], Error>({
    queryKey: ['household', 'expense-years'],
    queryFn: async () => {
      const res = await authFetcher('/api/household/expenses/years/')
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || '年次データの取得に失敗しました。')
      }
      return parsed as number[]
    },
    staleTime: 0,
  })

  const effectiveYear = useMemo(() => {
    if (!availableYears || availableYears.length === 0) return selectedYear
    return availableYears.includes(selectedYear) ? selectedYear : availableYears[0]
  }, [availableYears, selectedYear])

  const {
    data: yearlySummaries,
    status: yearlyStatus,
    fetchStatus: yearlyFetchStatus,
    error: yearlyError,
  } = useQuery<HouseholdSummary[], Error>({
    queryKey: ['household', 'annual-summary', effectiveYear],
    queryFn: () => fetchAnnualSummaries(effectiveYear),
    staleTime: 0,
    enabled: (availableYears?.length ?? 0) > 0,
  })

  const {
    data: previousSummaries,
  } = useQuery<HouseholdSummary[], Error>({
    queryKey: ['household', 'annual-summary', effectiveYear - 1],
    queryFn: () => fetchAnnualSummaries(effectiveYear - 1),
    staleTime: 0,
    enabled: (availableYears?.length ?? 0) > 0,
  })

  const { monthlyTotals, categorySeries } = useMemo(() => {
    const totals = Array.from({ length: 12 }, () => 0)
    const categoryMap = new Map<number, CategorySeries>()

    if (yearlySummaries) {
      yearlySummaries.forEach((summary, index) => {
        const monthItems = summary?.items ?? []
        let monthTotal = 0
        monthItems.forEach((item) => {
          const amount = toNumber(item.total)
          monthTotal += amount
          if (!categoryMap.has(item.categoryId)) {
            categoryMap.set(item.categoryId, {
              name: item.categoryName,
              color: resolveCategoryColor(item.categoryName, item.categoryColor),
              values: Array.from({ length: 12 }, () => 0),
              total: 0,
            })
          }
          const entry = categoryMap.get(item.categoryId)
          if (entry) {
            entry.values[index] += amount
            entry.total += amount
          }
        })
        totals[index] = monthTotal
      })
    }

    return {
      monthlyTotals: totals,
      categorySeries: Array.from(categoryMap.values()).sort((a, b) => b.total - a.total),
    }
  }, [yearlySummaries])

  const totalAmount = monthlyTotals.reduce((sum, value) => sum + value, 0)
  const monthlyAverage = monthlyTotals.length ? Math.round(totalAmount / 12) : 0

  const previousTotal = useMemo(() => {
    if (!previousSummaries) return 0
    return previousSummaries.reduce((sum, summary) => {
      const monthSum = (summary?.items ?? []).reduce(
        (innerSum, item) => innerSum + toNumber(item.total),
        0
      )
      return sum + monthSum
    }, 0)
  }, [previousSummaries])

  const yearOverYear = previousTotal > 0 ? ((totalAmount - previousTotal) / previousTotal) * 100 : null

  const stackedChartData = useMemo(() => {
    return {
      labels: monthLabels,
      datasets: categorySeries.map((series) => ({
        label: series.name,
        data: series.values,
        backgroundColor: series.color,
        borderRadius: 0,
        borderSkipped: false,
      })),
    }
  }, [categorySeries])

  const pieChartData = useMemo(() => {
    return {
      labels: categorySeries.map((series) => series.name),
      datasets: [
        {
          data: categorySeries.map((series) => series.total),
          backgroundColor: categorySeries.map((series) => series.color),
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    }
  }, [categorySeries])

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[1rem] font-semibold text-[#0d2b32]">年次レポート</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[0.7rem] font-semibold text-[#5d6a72]" htmlFor="annual-year">
              対象年
            </label>
            <select
              id="annual-year"
              className="rounded-full border border-[#d7dee4] bg-white px-3 py-1 text-[0.7rem] font-semibold text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
              value={effectiveYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              disabled={!availableYears || availableYears.length === 0}
            >
              {(availableYears ?? []).length === 0 && (
                <option value={effectiveYear}>データなし</option>
              )}
              {(availableYears ?? []).map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
              onClick={() => navigate('/household')}
            >
              月次へ戻る
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
            <p className="text-xs font-semibold text-[#5d6a72]">年間合計</p>
            <p className="mt-2 text-xl font-semibold text-[#0d2b32]">{formatYen(totalAmount)}</p>
            <p className="mt-1 text-[0.7rem] text-[#5d6a72]">{effectiveYear}年の累計</p>
          </div>
          <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
            <p className="text-xs font-semibold text-[#5d6a72]">月平均</p>
            <p className="mt-2 text-xl font-semibold text-[#0d2b32]">{formatYen(monthlyAverage)}</p>
            <p className="mt-1 text-[0.7rem] text-[#5d6a72]">12ヶ月平均</p>
          </div>
          <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
            <p className="text-xs font-semibold text-[#5d6a72]">前年比</p>
            <p className="mt-2 text-xl font-semibold text-[#0d2b32]">
              {yearOverYear === null ? '—' : `${yearOverYear > 0 ? '+' : ''}${yearOverYear.toFixed(1)}%`}
            </p>
            <p className="mt-1 text-[0.7rem] text-[#5d6a72]">前年との比較</p>
          </div>
        </div>

        {yearlyStatus === 'pending' && yearlyFetchStatus === 'idle' && (
          <p className="text-sm text-[#5d6a72]">支出データがありません。</p>
        )}
        {yearlyStatus === 'pending' && yearlyFetchStatus !== 'idle' && (
          <p className="text-sm text-[#5d6a72]">年次データを読み込み中...</p>
        )}
        {yearlyStatus === 'error' && (
          <p className="text-sm text-[#a33a2b]">
            {yearlyError?.message ?? '年次データの取得に失敗しました。'}
          </p>
        )}

        {yearlyStatus === 'success' && (
          <div className="grid gap-6">
            <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
              <div className="flex items-center justify-between gap-3 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-[#0d2b32]">月別積み上げ</h3>
                  <p className="text-xs text-[#5d6a72]">カテゴリ別の月次推移</p>
                </div>
                <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 text-[0.7rem] font-semibold text-[#0d2b32]">
                  {effectiveYear}年
                </span>
              </div>
              {categorySeries.length === 0 ? (
                <p className="text-sm text-[#5d6a72]">年次データがまだありません。</p>
              ) : (
                <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4">
                  <Bar
                    data={stackedChartData}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            color: '#23323a',
                            font: { size: 11, weight: 'bold' },
                            boxWidth: 12,
                            padding: 10,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context) => {
                              const label = context.dataset.label ?? ''
                              const value = context.raw as number
                              return `${label}: ${formatYen(value)}`
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          stacked: true,
                          ticks: { color: '#5d6a72', maxRotation: 0 },
                          grid: { display: false },
                        },
                        y: {
                          stacked: true,
                          ticks: { color: '#5d6a72' },
                          grid: { color: '#eef2f5' },
                        },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
              <div className="flex items-center justify-between gap-3 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-[#0d2b32]">カテゴリ比率</h3>
                  <p className="text-xs text-[#5d6a72]">年間の支出構成</p>
                </div>
              </div>
              {categorySeries.length === 0 ? (
                <p className="text-sm text-[#5d6a72]">データがありません。</p>
              ) : (
                <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4">
                    <Pie
                      data={pieChartData}
                      options={{
                        plugins: {
                          legend: {
                            position: 'bottom',
                            labels: {
                              color: '#23323a',
                              font: { size: 11, weight: 'bold' },
                              boxWidth: 12,
                              padding: 10,
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
                  <div className="flex min-h-full flex-col gap-3 rounded-2xl border border-[#e0e6eb] bg-[#fbfbfc] p-4">
                    <div className="text-xs font-semibold text-[#5d6a72]">カテゴリ内訳</div>
                    {categorySeries.map((item) => (
                      <div key={item.name} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          ></span>
                          <span className="text-sm font-medium text-[#0f1c22]">{item.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-[#0f1c22]">
                          {formatYen(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

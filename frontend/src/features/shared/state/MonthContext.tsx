import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type MonthState = {
  year: number
  month: number
  monthLabel: string
  setYearMonth: (year: number, month: number) => void
  setMonthLabel: (label: string) => void
}

const MonthContext = createContext<MonthState | null>(null)

const toLabel = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`

export function MonthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => {
    // 公開デモは記録済みデータの基準月から始める (VITE_DEMO_ANCHOR_MONTH は .env.demo)
    const anchor = import.meta.env.VITE_DEMO_ANCHOR_MONTH as string | undefined
    if (anchor) {
      const [y, m] = anchor.split('-').map(Number)
      if (y && m >= 1 && m <= 12) return { year: y, month: m }
    }
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  const value = useMemo<MonthState>(() => {
    return {
      year: state.year,
      month: state.month,
      monthLabel: toLabel(state.year, state.month),
      setYearMonth: (year, month) => setState({ year, month }),
      setMonthLabel: (label: string) => {
        const [y, m] = label.split('-')
        const year = Number(y)
        const month = Number(m)
        if (
          Number.isFinite(year) &&
          Number.isFinite(month) &&
          month >= 1 &&
          month <= 12
        ) {
          setState({ year, month })
        }
      },
    }
  }, [state.year, state.month])

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>
}

// Provider と同じファイルに置く React Context の定石。Fast Refresh の警告だけ抑止する
// eslint-disable-next-line react-refresh/only-export-components
export function useMonth() {
  const ctx = useContext(MonthContext)
  if (!ctx) {
    throw new Error('useMonth must be used within MonthProvider')
  }
  return ctx
}

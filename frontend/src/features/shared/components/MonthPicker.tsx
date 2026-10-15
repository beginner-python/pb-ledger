import { useEffect, useRef, useState } from 'react'
import { buttonClasses } from '../../../ui/button'

type MonthPickerProps = {
  year: number
  month: number
  today: Date
  onChange: (year: number, month: number) => void
  prevLabel?: string
  nextLabel?: string
  menuAlign?: 'center' | 'right'
}

export default function MonthPicker({
  year,
  month,
  today,
  onChange,
  prevLabel = '前月',
  nextLabel = '翌月',
  menuAlign = 'center',
}: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => year)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handlePrev = () => {
    const prevDate = new Date(year, month - 2, 1)
    onChange(prevDate.getFullYear(), prevDate.getMonth() + 1)
  }

  const handleNext = () => {
    const nextDate = new Date(year, month, 1)
    onChange(nextDate.getFullYear(), nextDate.getMonth() + 1)
  }

  const menuPositionClass =
    menuAlign === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2'

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
        onClick={handlePrev}
      >
        {prevLabel}
      </button>
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          className={buttonClasses({
            variant: 'secondary',
            size: 'sm',
            shape: 'pill',
            className: 'min-w-[140px] px-3 py-2 text-sm text-[#0d2b32]',
          })}
          onClick={() => {
            if (!isOpen) {
              setPickerYear(year)
            }
            setIsOpen((prev) => !prev)
          }}
        >
          {year}年{month}月
        </button>
        {isOpen && (
          <div
            className={`absolute ${menuPositionClass} top-full z-10 mt-2 w-[240px] rounded-2xl border border-[#d7dee4] bg-white p-4 shadow-[0_18px_42px_rgba(16,38,49,0.16)]`}
          >
            <div className="flex items-center justify-between pb-3">
              <button
                type="button"
                className={buttonClasses({
                  variant: 'ghost',
                  size: 'sm',
                  shape: 'pill',
                })}
                onClick={() => setPickerYear((prev) => prev - 1)}
              >
                前年
              </button>
              <span className="text-sm font-semibold text-[#0d2b32]">{pickerYear}年</span>
              <button
                type="button"
                className={buttonClasses({
                  variant: 'ghost',
                  size: 'sm',
                  shape: 'pill',
                })}
                onClick={() => setPickerYear((prev) => prev + 1)}
              >
                翌年
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 12 }, (_, index) => {
                const pickerMonth = index + 1
                const isActive = pickerMonth === month && pickerYear === year
                return (
                  <button
                    key={pickerMonth}
                    type="button"
                    className={buttonClasses({
                      variant: isActive ? 'success' : 'secondary',
                      size: 'xs',
                      shape: 'rounded',
                      className: 'rounded-lg px-2 py-1.5 text-xs',
                    })}
                    onClick={() => {
                      onChange(pickerYear, pickerMonth)
                      setIsOpen(false)
                    }}
                  >
                    {pickerMonth}月
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                className={buttonClasses({
                  variant: 'ghost',
                  size: 'sm',
                  shape: 'rounded',
                  className: 'rounded-lg px-3 py-1.5 text-xs',
                })}
                onClick={() => setIsOpen(false)}
              >
                閉じる
              </button>
              <button
                type="button"
                className={buttonClasses({
                  variant: 'success',
                  size: 'sm',
                  shape: 'rounded',
                  className: 'rounded-lg px-3 py-1.5 text-xs',
                })}
                onClick={() => {
                  onChange(today.getFullYear(), today.getMonth() + 1)
                  setPickerYear(today.getFullYear())
                  setIsOpen(false)
                }}
              >
                今月
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
        onClick={handleNext}
      >
        {nextLabel}
      </button>
    </div>
  )
}

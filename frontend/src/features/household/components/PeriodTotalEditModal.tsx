import { useState } from 'react'
import type { FormEvent } from 'react'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'

type Props = {
  isOpen: boolean
  onClose: () => void
  targetDate: { year: number; month: number }
  initialAmount: number | null
  onSubmit: (amount: number | null) => void
  isSubmitting: boolean
  errorMessage?: string
}

export default function PeriodTotalEditModal(props: Props) {
  if (!props.isOpen) return null
  // 開くたびにフォームをマウントし直し、初期値は useState の初期化で与える
  // (effect 内の setState を避けるため)
  return <PeriodTotalEditForm key={props.initialAmount ?? 'none'} {...props} />
}

function PeriodTotalEditForm({
  onClose,
  targetDate,
  initialAmount,
  onSubmit,
  isSubmitting,
  errorMessage,
}: Props) {
  const [amount, setAmount] = useState(() =>
    initialAmount !== null && initialAmount > 0 ? String(initialAmount) : ''
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = amount.trim()
    if (trimmed === '') {
      onSubmit(null)
      return
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num < 0) {
      return
    }
    onSubmit(num)
  }

  const handleClear = () => {
    onSubmit(null)
  }

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-[420px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#0d2b32]">月の上限</h3>
            <p className="mt-1 text-xs text-[#5d6a72]">
              {targetDate.year}年{targetDate.month}月の支出上限を設定します。
            </p>
          </div>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        <form className="mt-5 grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="period-total-amount">
              上限金額
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                ¥
              </span>
              <input
                id="period-total-amount"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="例: 150000"
                className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <p className="text-[10px] text-[#5d6a72]">空のまま保存すると上限を解除します。</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
              onClick={handleClear}
              disabled={isSubmitting || initialAmount === null}
            >
              上限を解除
            </button>
            <div className="flex flex-col items-end gap-1 text-right">
              <button
                type="submit"
                disabled={isSubmitting}
                className={buttonClasses({
                  variant: 'primary',
                  size: 'md',
                  shape: 'pill',
                  className: isSubmitting
                    ? 'border-transparent bg-[#cfd8dd] text-[#60707a]'
                    : 'px-5',
                })}
              >
                {isSubmitting ? '保存中...' : '保存'}
              </button>
              {errorMessage && (
                <span className="text-[0.7rem] text-[#a33a2b]">{errorMessage}</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  )
}

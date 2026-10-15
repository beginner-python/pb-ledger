import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { HouseholdCategoryOption } from '../types/householdTypes'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import CategoryTreeSelect from './CategoryTreeSelect'

type BudgetFormState = {
  category: string
  amount: string
  notes: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  targetDate: { year: number; month: number }
  budgetForm: BudgetFormState
  setBudgetForm: Dispatch<SetStateAction<BudgetFormState>>
  availableBudgetCategories: HouseholdCategoryOption[]
  categoryStatus: 'pending' | 'error' | 'success'
  categoryErrorMessage?: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSubmitAndContinue: () => void
  onClear: () => void
  isSubmitting: boolean
  validationMessage: string
  submitErrorMessage?: string
  submitSuccess: boolean
}

export default function BudgetCreateModal({
  isOpen,
  onClose,
  targetDate,
  budgetForm,
  setBudgetForm,
  availableBudgetCategories,
  categoryStatus,
  categoryErrorMessage,
  onSubmit,
  onSubmitAndContinue,
  onClear,
  isSubmitting,
  validationMessage,
  submitErrorMessage,
  submitSuccess,
}: Props) {
  if (!isOpen) return null

  const hasStatusMessage =
    Boolean(validationMessage) || Boolean(submitErrorMessage) || submitSuccess
  const statusMessage = validationMessage
    ? validationMessage
    : submitErrorMessage
      ? submitErrorMessage
      : '予算を登録しました。'
  const statusTone =
    validationMessage || submitErrorMessage ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-[#0d2b32]">予算を追加</h4>
            <p className="mt-1 text-xs text-[#5d6a72]">
              {targetDate.year}年{targetDate.month}月の予算を登録します。
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
        <form className="mt-5 grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="budget-category">
              カテゴリ
            </label>
            <CategoryTreeSelect
              id="budget-category"
              categories={availableBudgetCategories}
              value={budgetForm.category}
              onChange={(next) =>
                setBudgetForm((prev) => ({ ...prev, category: next }))
              }
            />
            {availableBudgetCategories.length === 0 && (
              <p className="text-[0.7rem] text-[#5d6a72]">
                すべてのカテゴリに予算が登録済みです。
              </p>
            )}
            {categoryStatus === 'error' && (
              <p className="text-[0.7rem] text-[#a33a2b]">
                {categoryErrorMessage ?? 'カテゴリを取得できませんでした。'}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="budget-amount">
              予算額
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                ¥
              </span>
              <input
                id="budget-amount"
                type="number"
                inputMode="numeric"
                placeholder="例: 30000"
                className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={budgetForm.amount}
                onChange={(event) =>
                  setBudgetForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="budget-notes">
              備考
            </label>
            <input
              id="budget-notes"
              type="text"
              placeholder="例: 今月は外食多め"
              className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
              value={budgetForm.notes}
              onChange={(event) =>
                setBudgetForm((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
              onClick={onClear}
            >
              クリア
            </button>
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  className={buttonClasses({
                    variant: 'secondary',
                    size: 'md',
                    shape: 'pill',
                    className: isSubmitting
                      ? 'border-transparent bg-[#cfd8dd] text-[#60707a]'
                      : '',
                  })}
                  onClick={onSubmitAndContinue}
                >
                  連続追加
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={buttonClasses({
                    variant: 'primary',
                    size: 'md',
                    shape: 'pill',
                    className: isSubmitting
                      ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                      : 'px-5',
                  })}
                >
                  {isSubmitting ? '保存中...' : '保存'}
                </button>
              </div>
              {hasStatusMessage && (
                <span className={`text-[0.7rem] ${statusTone}`}>{statusMessage}</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  )
}

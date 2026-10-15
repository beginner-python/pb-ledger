import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { BudgetDisplayItem, HouseholdCategoryOption } from '../types/householdTypes'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import CategoryTreeSelect from './CategoryTreeSelect'

type BudgetEditFormState = {
  category: string
  amount: string
  notes: string
}

type Props = {
  item: BudgetDisplayItem | null
  onClose: () => void
  budgetEditForm: BudgetEditFormState
  setBudgetEditForm: Dispatch<SetStateAction<BudgetEditFormState>>
  sortedCategories: HouseholdCategoryOption[]
  categoryStatus: 'pending' | 'error' | 'success'
  categoryErrorMessage?: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onReset: () => void
  isSubmitting: boolean
  statusMessage: string
  submitErrorMessage?: string
  submitSuccess: boolean
}

export default function BudgetEditModal({
  item,
  onClose,
  budgetEditForm,
  setBudgetEditForm,
  sortedCategories,
  categoryStatus,
  categoryErrorMessage,
  onSubmit,
  onReset,
  isSubmitting,
  statusMessage,
  submitErrorMessage,
  submitSuccess,
}: Props) {
  if (!item) return null

  const hasStatusMessage =
    Boolean(statusMessage) || Boolean(submitErrorMessage) || submitSuccess
  const message = statusMessage
    ? statusMessage
    : submitErrorMessage
      ? submitErrorMessage
      : '予算を更新しました。'
  const statusTone = submitErrorMessage ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-[#0d2b32]">予算の編集</h4>
            <p className="mt-1 text-xs text-[#5d6a72]">登録済みの予算を更新します。</p>
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
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-budget-category">
              カテゴリ
            </label>
            <CategoryTreeSelect
              id="edit-budget-category"
              categories={sortedCategories}
              value={budgetEditForm.category}
              onChange={(next) =>
                setBudgetEditForm((prev) => ({ ...prev, category: next }))
              }
            />
            {categoryStatus === 'error' && (
              <p className="text-[0.7rem] text-[#a33a2b]">
                {categoryErrorMessage ?? 'カテゴリを取得できませんでした。'}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-budget-amount">
              予算額
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                ¥
              </span>
              <input
                id="edit-budget-amount"
                type="number"
                inputMode="numeric"
                className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={budgetEditForm.amount}
                onChange={(event) =>
                  setBudgetEditForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-budget-notes">
              備考
            </label>
            <input
              id="edit-budget-notes"
              type="text"
              className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
              value={budgetEditForm.notes}
              onChange={(event) =>
                setBudgetEditForm((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
              onClick={onReset}
            >
              リセット
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
                    ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                    : 'px-5',
                })}
              >
                {isSubmitting ? '更新中...' : '更新'}
              </button>
              {hasStatusMessage && (
                <span className={`text-[0.7rem] ${statusTone}`}>{message}</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  )
}

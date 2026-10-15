import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type {
  HouseholdCategoryOption,
  PaymentAccountOption,
} from '../types/householdTypes'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import CategoryTreeSelect from './CategoryTreeSelect'

type ExpenseFormState = {
  amount: string
  category: string
  date: string
  notes: string
  paymentAccountId: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  expenseForm: ExpenseFormState
  setExpenseForm: Dispatch<SetStateAction<ExpenseFormState>>
  sortedCategories: HouseholdCategoryOption[]
  categoryStatus: 'pending' | 'error' | 'success'
  categoryErrorMessage?: string
  paymentAccounts: PaymentAccountOption[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSubmitAndContinue: () => void
  onClear: () => void
  isSubmitting: boolean
  validationMessage: string
  submitErrorMessage?: string
  submitSuccess: boolean
}

const PAYMENT_KIND_LABELS: Record<string, string> = {
  bank_account: '銀行',
  credit_card: 'カード',
  cash: '現金',
}

export default function ExpenseCreateModal({
  isOpen,
  onClose,
  expenseForm,
  setExpenseForm,
  sortedCategories,
  categoryStatus,
  categoryErrorMessage,
  paymentAccounts,
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
      : '支出を登録しました。'
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
            <h4 className="text-base font-semibold text-[#0d2b32]">支出の追加</h4>
            <p className="mt-1 text-xs text-[#5d6a72]">
              ここで支出を入力して、登録までの流れを最短化します。
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
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-amount">
              金額
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#5d6a72]">
                ¥
              </span>
              <input
                id="expense-amount"
                type="number"
                inputMode="numeric"
                placeholder="例: 1200"
                className="w-full rounded-xl border border-[#d7dee4] bg-white py-2 pl-8 pr-3 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={expenseForm.amount}
                onChange={(event) =>
                  setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-category">
              カテゴリ
            </label>
            <CategoryTreeSelect
              id="expense-category"
              categories={sortedCategories}
              value={expenseForm.category}
              onChange={(next) =>
                setExpenseForm((prev) => ({ ...prev, category: next }))
              }
            />
            {categoryStatus === 'error' && (
              <p className="text-[0.7rem] text-[#a33a2b]">
                {categoryErrorMessage ?? 'カテゴリを取得できませんでした。'}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <label
              className="text-xs font-semibold text-[#0d2b32]"
              htmlFor="expense-payment-account"
            >
              支払元 (任意)
            </label>
            <select
              id="expense-payment-account"
              className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
              value={expenseForm.paymentAccountId}
              onChange={(event) =>
                setExpenseForm((prev) => ({
                  ...prev,
                  paymentAccountId: event.target.value,
                }))
              }
            >
              <option value="">未割当</option>
              {paymentAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  [{PAYMENT_KIND_LABELS[account.kind] ?? account.kind}] {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-date">
                日付
              </label>
              <input
                id="expense-date"
                type="date"
                className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={expenseForm.date}
                onChange={(event) =>
                  setExpenseForm((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="expense-notes">
                備考
              </label>
              <input
                id="expense-notes"
                type="text"
                placeholder="例: ランチ"
                className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                value={expenseForm.notes}
                onChange={(event) =>
                  setExpenseForm((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
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

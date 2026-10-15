import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { AccountTransaction, AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'
import type { HouseholdCategoryOption } from '../../household/types/householdTypes'
import CategoryTreeSelect from '../../household/components/CategoryTreeSelect'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import { buttonClasses } from '../../../ui/button'
import { getTxCapacity } from './transactionLinks'

type Props = {
  tx: AccountTransaction
  account: AssetAccount
  categories: HouseholdCategoryOption[]
  displayAmount: (value: number | string | null | undefined) => string
  onClose: () => void
}

/** 明細 1 件を家計簿の支出として登録する (明細に自動で紐付く) */
export default function ExpenseFromTxModal({ tx, account, categories, displayAmount, onClose }: Props) {
  const queryClient = useQueryClient()
  const [expenseTxForm, setExpenseTxForm] = useState(() => {
    const { remaining } = getTxCapacity(tx)
    return {
      amount: remaining > 0 ? String(remaining) : '',
      categoryId: '',
      date: tx.date,
      notes: tx.description || '',
      paymentAccountId: String(account.accountId),
    }
  })
  const [expenseTxStatus, setExpenseTxStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [expenseTxMessage, setExpenseTxMessage] = useState('')

  const submitExpenseFromTx = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tx) return
    if (!expenseTxForm.categoryId) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('カテゴリを選択してください。')
      return
    }
    const trimmedAmount = expenseTxForm.amount.trim()
    if (!trimmedAmount) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('金額を入力してください。')
      return
    }
    const submittedAmount = Number(trimmedAmount)
    if (!Number.isFinite(submittedAmount) || submittedAmount <= 0) {
      setExpenseTxStatus('error')
      setExpenseTxMessage('金額は0より大きい数値で入力してください。')
      return
    }
    const { remaining } = getTxCapacity(tx)
    if (submittedAmount > remaining + 1e-6) {
      setExpenseTxStatus('error')
      setExpenseTxMessage(
        `明細の残り登録可能金額は ¥${remaining.toLocaleString()} です。`
      )
      return
    }
    setExpenseTxStatus('loading')
    setExpenseTxMessage('')
    try {
      const res = await authFetcher('/api/household/expenses/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: expenseTxForm.amount,
          categoryId: Number(expenseTxForm.categoryId),
          date: expenseTxForm.date,
          notes: expenseTxForm.notes,
          paymentAccountId: Number(expenseTxForm.paymentAccountId),
          sourceTransactionId: tx.id,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || '支出の登録に失敗しました。')
      }
      setExpenseTxStatus('success')
      setExpenseTxMessage('支出を登録しました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      window.setTimeout(onClose, 600)
    } catch (err) {
      setExpenseTxStatus('error')
      setExpenseTxMessage(
        err instanceof Error ? err.message : '支出の登録に失敗しました。'
      )
    }
  }


  return (
      <ModalBackdrop onClose={() => onClose()}>
        <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-[#0d2b32]">明細を支出に変換</p>
              <p className="mt-1 text-xs text-[#5d6a72]">
                この明細を家計支出として登録します。明細とは自動的に紐付きます。
              </p>
            </div>
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
              onClick={() => onClose()}
            >
              閉じる
            </button>
          </div>
          <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
            <div>明細日: {tx.date}</div>
            <div>明細内容: {tx.description || '—'}</div>
            <div>明細金額: {displayAmount(tx.amount)}</div>
            {(() => {
              const capacity = getTxCapacity(tx)
              if (capacity.linkedAmount <= 0) return null
              return (
                <>
                  <div>
                    既に登録: ¥{capacity.linkedAmount.toLocaleString()}
                    {capacity.linkedCount > 0 && `（${capacity.linkedCount}件）`}
                  </div>
                  <div className="text-[#1a7b6d]">
                    残り登録可能: ¥{capacity.remaining.toLocaleString()}
                  </div>
                </>
              )
            })()}
          </div>
          <form className="mt-4 grid gap-3" onSubmit={submitExpenseFromTx}>
            <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
              <span>カテゴリ</span>
              <CategoryTreeSelect
                className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                categories={categories}
                value={expenseTxForm.categoryId}
                onChange={(next) =>
                  setExpenseTxForm((prev) => ({ ...prev, categoryId: next }))
                }
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>金額</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={getTxCapacity(tx).remaining || undefined}
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={expenseTxForm.amount}
                  onChange={(event) =>
                    setExpenseTxForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>日付</span>
                <input
                  type="date"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={expenseTxForm.date}
                  onChange={(event) =>
                    setExpenseTxForm((prev) => ({ ...prev, date: event.target.value }))
                  }
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
              <span>備考</span>
              <input
                type="text"
                className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                value={expenseTxForm.notes}
                onChange={(event) =>
                  setExpenseTxForm((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </label>
            <div className="flex items-center justify-end gap-3 pt-1">
              {expenseTxStatus !== 'idle' && expenseTxMessage && (
                <span
                  className={`text-[0.7rem] ${
                    expenseTxStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                  }`}
                >
                  {expenseTxMessage}
                </span>
              )}
              <button
                type="submit"
                disabled={expenseTxStatus === 'loading'}
                className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
              >
                {expenseTxStatus === 'loading' ? '登録中...' : '支出として登録'}
              </button>
            </div>
          </form>
        </div>
      </ModalBackdrop>
  )
}

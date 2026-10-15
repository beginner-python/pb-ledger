import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { AccountTransaction, AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import { buttonClasses } from '../../../ui/button'
import { filterLinkableExpenses, getTxCapacity } from './transactionLinks'
import type { LinkableExpense } from './transactionLinks'

type Props = {
  tx: AccountTransaction
  account: AssetAccount
  displayAmount: (value: number | string | null | undefined) => string
  linkableExpenses: LinkableExpense[]
  isLoadingExpenses: boolean
  expensesError: Error | null
  onClose: () => void
}

/** 明細を、同月・未紐付けの既存支出に紐付ける */
export default function LinkExpenseModal({
  tx,
  account,
  displayAmount,
  linkableExpenses,
  isLoadingExpenses,
  expensesError,
  onClose,
}: Props) {
  const queryClient = useQueryClient()
  const [linkExpenseId, setLinkExpenseId] = useState<string>('')
  const [linkTxStatus, setLinkTxStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [linkTxMessage, setLinkTxMessage] = useState('')

  const submitLinkExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tx) return
    if (!linkExpenseId) {
      setLinkTxStatus('error')
      setLinkTxMessage('紐付ける支出を選択してください。')
      return
    }
    setLinkTxStatus('loading')
    setLinkTxMessage('')
    try {
      const res = await authFetcher(
        `/api/household/expenses/${linkExpenseId}/`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTransactionId: tx.id,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || '紐付けに失敗しました。')
      }
      setLinkTxStatus('success')
      setLinkTxMessage('明細を支出に紐付けました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      window.setTimeout(onClose, 600)
    } catch (err) {
      setLinkTxStatus('error')
      setLinkTxMessage(
        err instanceof Error ? err.message : '紐付けに失敗しました。'
      )
    }
  }


  return (
      <ModalBackdrop onClose={() => onClose()}>
        <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-[#0d2b32]">既存の支出と紐付け</p>
              <p className="mt-1 text-xs text-[#5d6a72]">
                この明細を、未紐付けの既存支出に紐付けます。
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
              const cap = getTxCapacity(tx)
              if (cap.linkedAmount <= 0) return null
              return (
                <>
                  <div>既に登録: ¥{cap.linkedAmount.toLocaleString()}</div>
                  <div className="text-[#1a7b6d]">
                    残り登録可能: ¥{cap.remaining.toLocaleString()}
                  </div>
                </>
              )
            })()}
          </div>
          <form className="mt-4 grid gap-3" onSubmit={submitLinkExpense}>
            <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
              <span>
                紐付ける支出 (同月・{account.accountName}/未割当・残額¥
                {getTxCapacity(tx).remaining.toLocaleString()}以下)
              </span>
              {(() => {
                const remaining = getTxCapacity(tx).remaining
                const filtered = filterLinkableExpenses(linkableExpenses, remaining)
                return (
                  <select
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={linkExpenseId}
                    onChange={(event) => setLinkExpenseId(event.target.value)}
                  >
                    <option value="">
                      {isLoadingExpenses
                        ? '読み込み中...'
                        : filtered.length === 0
                          ? '金額条件に合う支出がありません'
                          : '支出を選択してください'}
                    </option>
                    {filtered.map((expense) => {
                      const unassigned = expense.paymentAccountId == null
                      return (
                        <option key={expense.id} value={expense.id}>
                          {expense.date} / {expense.categoryName} / ¥{Number(expense.amount ?? 0).toLocaleString()}
                          {expense.notes ? ` / ${expense.notes}` : ''}
                          {unassigned ? ' [支払元未割当]' : ''}
                        </option>
                      )
                    })}
                  </select>
                )
              })()}
            </label>
            {Boolean(expensesError) && (
              <p className="text-[0.7rem] text-[#a33a2b]">
                {expensesError?.message ?? '支出の取得に失敗しました。'}
              </p>
            )}
            <p className="text-[0.65rem] text-[#7a8790]">
              支払元: 同口座 / 未割当 の支出のみ表示。未割当は紐付け時に「{account.accountName}」に自動セット。
            </p>
            <div className="flex items-center justify-end gap-3 pt-1">
              {linkTxStatus !== 'idle' && linkTxMessage && (
                <span
                  className={`text-[0.7rem] ${
                    linkTxStatus === 'error' ? 'text-[#a33a2b]' : 'text-[#0e4f2c]'
                  }`}
                >
                  {linkTxMessage}
                </span>
              )}
              <button
                type="submit"
                disabled={linkTxStatus === 'loading' || !linkExpenseId}
                className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
              >
                {linkTxStatus === 'loading' ? '紐付け中...' : '紐付ける'}
              </button>
            </div>
          </form>
        </div>
      </ModalBackdrop>
  )
}

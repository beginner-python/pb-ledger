import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { AccountTransaction } from '../types/types'
import { authFetcher } from '../../../api/client'
import type { HouseholdCategoryOption } from '../../household/types/householdTypes'
import CategoryTreeSelect from '../../household/components/CategoryTreeSelect'
import { resolveCategoryColor } from '../../household/utils/categoryColors'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import { buttonClasses } from '../../../ui/button'
import { getTxCapacity } from './transactionLinks'
import type { LinkedExpense } from './transactionLinks'

type Props = {
  tx: AccountTransaction
  categories: HouseholdCategoryOption[]
  displayAmount: (value: number | string | null | undefined) => string
  onClose: () => void
}

/** 明細に紐付いた支出の一覧と、その場での編集・削除 */
export default function LinkedExpensesModal({ tx, categories, displayAmount, onClose }: Props) {
  const queryClient = useQueryClient()
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null)
  const [editExpenseForm, setEditExpenseForm] = useState({
    amount: '',
    categoryId: '',
    date: '',
    notes: '',
  })
  const [editExpenseStatus, setEditExpenseStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [editExpenseMessage, setEditExpenseMessage] = useState('')

  const linkedExpensesQuery = useQuery<LinkedExpense[], Error>({
    queryKey: [
      'household',
      'expenses',
      'by-tx',
      tx?.id ?? null,
    ],
    queryFn: async () => {
      if (!tx) return []
      const params = new URLSearchParams({
        sourceTransactionId: String(tx.id),
      })
      const res = await authFetcher(`/api/household/expenses/?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.detail || '紐付け支出の取得に失敗しました。')
      }
      return Array.isArray(data) ? data : []
    },
    enabled: Boolean(tx),
    staleTime: 0,
  })


  const startEditExpense = (expense: {
    id: number
    date: string
    amount: string | null
    notes: string
    categoryId: number
  }) => {
    setEditingExpenseId(expense.id)
    setEditExpenseForm({
      amount: expense.amount ?? '',
      categoryId: String(expense.categoryId),
      date: expense.date,
      notes: expense.notes ?? '',
    })
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  const cancelEditExpense = () => {
    setEditingExpenseId(null)
    setEditExpenseStatus('idle')
    setEditExpenseMessage('')
  }

  // 1件しか紐付いていない場合はモーダル展開時に自動で編集モードに入る。
  // 同じモーダルセッションでキャンセル後に再オートする挙動を避けるため
  // tx.id 単位で1回だけ適用する。
  const autoEditAppliedTxIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!tx) {
      autoEditAppliedTxIdRef.current = null
      return
    }
    if (autoEditAppliedTxIdRef.current === tx.id) return
    const expenses = linkedExpensesQuery.data
    if (!expenses) return
    autoEditAppliedTxIdRef.current = tx.id
    if (expenses.length === 1) {
      // 紐付き支出が 1 件だけなら、取得完了時にそのまま編集状態へ入る
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startEditExpense(expenses[0])
    }
  }, [tx, linkedExpensesQuery.data])


  const submitEditExpense = async (
    event: FormEvent<HTMLFormElement>,
    expenseId: number
  ) => {
    event.preventDefault()
    if (!editExpenseForm.categoryId) {
      setEditExpenseStatus('error')
      setEditExpenseMessage('カテゴリを選択してください。')
      return
    }
    if (!editExpenseForm.amount.trim()) {
      setEditExpenseStatus('error')
      setEditExpenseMessage('金額を入力してください。')
      return
    }
    setEditExpenseStatus('loading')
    setEditExpenseMessage('')
    try {
      const res = await authFetcher(`/api/household/expenses/${expenseId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: editExpenseForm.amount,
          categoryId: Number(editExpenseForm.categoryId),
          date: editExpenseForm.date,
          notes: editExpenseForm.notes,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || '支出の更新に失敗しました。')
      }
      setEditExpenseStatus('success')
      setEditExpenseMessage('支出を更新しました。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
      setEditingExpenseId(null)
    } catch (err) {
      setEditExpenseStatus('error')
      setEditExpenseMessage(
        err instanceof Error ? err.message : '支出の更新に失敗しました。'
      )
    }
  }

  const deleteLinkedExpense = async (expenseId: number) => {
    if (!window.confirm('この支出を削除しますか？')) return
    setEditExpenseStatus('loading')
    setEditExpenseMessage('')
    try {
      const res = await authFetcher(`/api/household/expenses/${expenseId}/`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.detail || '支出の削除に失敗しました。')
      }
      setEditExpenseStatus('idle')
      setEditingExpenseId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ])
    } catch (err) {
      setEditExpenseStatus('error')
      setEditExpenseMessage(
        err instanceof Error ? err.message : '支出の削除に失敗しました。'
      )
    }
  }


  return (
      <ModalBackdrop onClose={onClose}>
        <div className="max-h-[calc(100vh-3rem)] w-full max-w-[560px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-[#0d2b32]">
                紐付け済みの支出
                {linkedExpensesQuery.data && linkedExpensesQuery.data.length > 0 && (
                  <span className="ml-2 text-xs text-[#5d6a72]">
                    ({linkedExpensesQuery.data.length}件)
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-[#5d6a72]">
                この明細に紐付いた支出を編集/削除します。
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
          <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
            <div>明細日: {tx.date}</div>
            <div>明細内容: {tx.description || '—'}</div>
            <div>明細金額: {displayAmount(tx.amount)}</div>
            {(() => {
              const cap = getTxCapacity(tx)
              return (
                <div className={cap.remaining > 0 ? 'text-[#1a7b6d]' : 'text-[#0e4f2c]'}>
                  合計 ¥{cap.linkedAmount.toLocaleString()} / 明細 ¥
                  {cap.txAmountAbs.toLocaleString()}
                  {cap.remaining > 0
                    ? ` ・残 ¥${cap.remaining.toLocaleString()}`
                    : ' ・全額紐付け済み'}
                </div>
              )
            })()}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {linkedExpensesQuery.isLoading && (
              <div className="rounded-2xl border border-[#e3e9ee] bg-white p-3 text-xs text-[#5d6a72]">
                読み込み中...
              </div>
            )}
            {linkedExpensesQuery.isError && (
              <div className="rounded-2xl border border-[#f2b4b4] bg-[#fff1f2] p-3 text-xs text-[#a33a2b]">
                {linkedExpensesQuery.error?.message ??
                  '紐付け支出の取得に失敗しました。'}
              </div>
            )}
            {linkedExpensesQuery.data?.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#d7dee4] bg-white p-3 text-xs text-[#5d6a72]">
                紐付いた支出はありません。
              </div>
            )}
            {(linkedExpensesQuery.data ?? []).map((expense) => {
              const isEditing = editingExpenseId === expense.id
              return (
                <div
                  key={expense.id}
                  className="rounded-2xl border border-[#e3e9ee] bg-white p-3 text-xs"
                >
                  {!isEditing ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor: resolveCategoryColor(
                                expense.categoryName,
                                expense.categoryColor
                              ),
                            }}
                          />
                          <span className="text-sm font-semibold text-[#0f1c22]">
                            {expense.categoryName}
                          </span>
                          <span className="text-[#5d6a72]">{expense.date}</span>
                        </div>
                        <div className="mt-1 text-sm font-bold text-[#0f1c22]">
                          ¥{Number(expense.amount ?? 0).toLocaleString()}
                        </div>
                        {expense.notes && (
                          <div className="mt-0.5 text-[#5d6a72]">
                            {expense.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <button
                          type="button"
                          className={buttonClasses({
                            variant: 'secondary',
                            size: 'xs',
                            shape: 'pill',
                          })}
                          onClick={() => startEditExpense(expense)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className={buttonClasses({
                            variant: 'danger',
                            size: 'xs',
                            shape: 'pill',
                          })}
                          onClick={() => deleteLinkedExpense(expense.id)}
                          disabled={editExpenseStatus === 'loading'}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      className="grid gap-2"
                      onSubmit={(event) => submitEditExpense(event, expense.id)}
                    >
                      <label className="grid gap-1 font-semibold text-[#0f1c22]">
                        <span>カテゴリ</span>
                        <CategoryTreeSelect
                          className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                          categories={categories}
                          value={editExpenseForm.categoryId}
                          onChange={(next) =>
                            setEditExpenseForm((prev) => ({
                              ...prev,
                              categoryId: next,
                            }))
                          }
                        />
                      </label>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="grid gap-1 font-semibold text-[#0f1c22]">
                          <span>金額</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                            value={editExpenseForm.amount}
                            onChange={(event) =>
                              setEditExpenseForm((prev) => ({
                                ...prev,
                                amount: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="grid gap-1 font-semibold text-[#0f1c22]">
                          <span>日付</span>
                          <input
                            type="date"
                            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                            value={editExpenseForm.date}
                            onChange={(event) =>
                              setEditExpenseForm((prev) => ({
                                ...prev,
                                date: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label className="grid gap-1 font-semibold text-[#0f1c22]">
                        <span>備考</span>
                        <input
                          type="text"
                          className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                          value={editExpenseForm.notes}
                          onChange={(event) =>
                            setEditExpenseForm((prev) => ({
                              ...prev,
                              notes: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          className={buttonClasses({
                            variant: 'danger',
                            size: 'xs',
                            shape: 'pill',
                          })}
                          onClick={() => deleteLinkedExpense(expense.id)}
                          disabled={editExpenseStatus === 'loading'}
                        >
                          削除
                        </button>
                        <div className="flex items-center gap-2">
                          {editExpenseStatus !== 'idle' && editExpenseMessage && (
                            <span
                              className={`text-[0.7rem] ${
                                editExpenseStatus === 'error'
                                  ? 'text-[#a33a2b]'
                                  : 'text-[#0e4f2c]'
                              }`}
                            >
                              {editExpenseMessage}
                            </span>
                          )}
                          <button
                            type="button"
                            className={buttonClasses({
                              variant: 'secondary',
                              size: 'xs',
                              shape: 'pill',
                            })}
                            onClick={cancelEditExpense}
                          >
                            キャンセル
                          </button>
                          <button
                            type="submit"
                            disabled={editExpenseStatus === 'loading'}
                            className={buttonClasses({
                              variant: 'primary',
                              size: 'xs',
                              shape: 'pill',
                            })}
                          >
                            {editExpenseStatus === 'loading' ? '保存中...' : '保存'}
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </ModalBackdrop>
  )
}

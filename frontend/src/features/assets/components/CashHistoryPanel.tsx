import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authFetcher } from '../../../api/client'
import { buttonClasses } from '../../../ui/button'
import {
  fetchHouseholdCategories,
  fetchPaymentAccounts,
} from '../../household/services/household'
import CategoryTreeSelect from '../../household/components/CategoryTreeSelect'
import DropdownMenu from '../../shared/components/DropdownMenu'
import type { DropdownMenuItem } from '../../shared/components/DropdownMenu'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import {
  createTransfer,
  deleteTransfer,
  updateTransfer,
} from '../services/transfers'
import {
  type CashAdjustmentDirection,
  type CashHistoryEntry,
  createCashAdjustment,
  deleteCashAdjustment,
  fetchCashHistory,
  updateCashAdjustment,
} from '../services/cashAdjustments'
import type { AssetAccount } from '../types/types'

type Props = {
  account: AssetAccount
  month: string
  displayAmount: (value: number | string | null | undefined) => string
}

type AdjustmentDraft = {
  date: string
  direction: CashAdjustmentDirection
  amount: string
  notes: string
}

import { todayString } from '../../shared/utils/date'

const emptyDraft = (date: string): AdjustmentDraft => ({
  date,
  direction: 'in',
  amount: '',
  notes: '',
})

type ExpenseDraft = {
  categoryId: string
  amount: string
  date: string
  notes: string
}

type TransferDraft = {
  direction: CashAdjustmentDirection
  otherAccountId: string
  amount: string
  date: string
  notes: string
}

const emptyTransferDraft = (date: string): TransferDraft => ({
  direction: 'out',
  otherAccountId: '',
  amount: '',
  date,
  notes: '',
})

const getAdjCapacity = (entry: CashHistoryEntry) => {
  const total = Math.abs(Number(entry.amountSigned || 0))
  const linked = Number(entry.linkedExpenseAmount ?? 0)
  const remaining = Math.max(0, total - linked)
  return {
    total,
    linked,
    remaining,
    linkedCount: entry.linkedExpenseCount ?? 0,
    isFullyAllocated: total > 0 && remaining <= 1e-6,
    isPartiallyAllocated: linked > 0 && remaining > 1e-6,
  }
}

export default function CashHistoryPanel({ account, month, displayAmount }: Props) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<AdjustmentDraft>(() =>
    emptyDraft(todayString())
  )
  const [createMessage, setCreateMessage] = useState('')
  const [editEntry, setEditEntry] = useState<CashHistoryEntry | null>(null)
  const [editDraft, setEditDraft] = useState<AdjustmentDraft>(() =>
    emptyDraft(todayString())
  )
  const [editMessage, setEditMessage] = useState('')
  const [expenseAdj, setExpenseAdj] = useState<CashHistoryEntry | null>(null)
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>({
    categoryId: '',
    amount: '',
    date: todayString(),
    notes: '',
  })
  const [expenseMessage, setExpenseMessage] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferDraft, setTransferDraft] = useState<TransferDraft>(() =>
    emptyTransferDraft(todayString())
  )
  const [transferMessage, setTransferMessage] = useState('')
  const [editTransfer, setEditTransfer] = useState<CashHistoryEntry | null>(null)
  const [transferEditDraft, setTransferEditDraft] = useState({
    date: todayString(),
    amount: '',
    notes: '',
  })
  const [transferEditMessage, setTransferEditMessage] = useState('')

  const categoriesQuery = useQuery({
    queryKey: ['household', 'categories'],
    queryFn: fetchHouseholdCategories,
    staleTime: 30_000,
  })

  const paymentAccountsQuery = useQuery({
    queryKey: ['ledger', 'payment-accounts'],
    queryFn: fetchPaymentAccounts,
    staleTime: 30_000,
    enabled: transferOpen,
  })

  // 相手は自口座以外の現金口座のみ（現金↔現金の振替）。
  const otherCashWallets = useMemo(
    () =>
      (paymentAccountsQuery.data ?? []).filter(
        (a) => a.kind === 'cash' && a.id !== account.accountId
      ),
    [paymentAccountsQuery.data, account.accountId]
  )

  const historyQuery = useQuery<CashHistoryEntry[], Error>({
    queryKey: ['ledger', 'cash-history', account.accountId, month],
    queryFn: () => fetchCashHistory(account.accountId, month),
    staleTime: 15_000,
  })

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ledger', 'cash-history'] }),
      queryClient.invalidateQueries({ queryKey: ['ledger', 'balance'] }),
      queryClient.invalidateQueries({ queryKey: ['balance'] }),
      queryClient.invalidateQueries({ queryKey: ['household'] }),
      queryClient.invalidateQueries({ queryKey: ['ledger', 'transfers'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
    ])
  }

  const expenseMutation = useMutation({
    mutationFn: async () => {
      if (!expenseAdj) throw new Error('対象が見つかりません。')
      const res = await authFetcher('/api/household/expenses/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: Number(expenseDraft.categoryId),
          amount: expenseDraft.amount,
          date: expenseDraft.date,
          notes: expenseDraft.notes,
          paymentAccountId: account.accountId,
          sourceCashAdjustmentId: expenseAdj.id,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || '支出の登録に失敗しました。')
      }
      return data
    },
    onSuccess: async () => {
      await invalidateAll()
      setExpenseAdj(null)
      setExpenseMessage('')
    },
    onError: (err: Error) => {
      setExpenseMessage(err.message)
    },
  })

  const openExpenseFromAdj = (entry: CashHistoryEntry) => {
    const cap = getAdjCapacity(entry)
    if (cap.isFullyAllocated) return
    setExpenseAdj(entry)
    setExpenseDraft({
      categoryId: '',
      amount: cap.remaining > 0 ? String(cap.remaining) : '',
      date: entry.date,
      notes: entry.notes || '',
    })
    setExpenseMessage('')
  }

  const submitExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setExpenseMessage('')
    if (!expenseAdj) return
    if (!expenseDraft.categoryId) {
      setExpenseMessage('カテゴリを選択してください。')
      return
    }
    const amt = Number(expenseDraft.amount)
    if (!amt || amt <= 0) {
      setExpenseMessage('金額は0より大きい値を入力してください。')
      return
    }
    const cap = getAdjCapacity(expenseAdj)
    if (amt > cap.remaining + 1e-6) {
      setExpenseMessage(`残り ¥${cap.remaining.toLocaleString()} まで登録できます。`)
      return
    }
    expenseMutation.mutate()
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createCashAdjustment({
        paymentAccountId: account.accountId,
        ...createDraft,
      }),
    onSuccess: async () => {
      await invalidateAll()
      setCreateOpen(false)
      setCreateDraft(emptyDraft(todayString()))
      setCreateMessage('')
    },
    onError: (err: Error) => {
      setCreateMessage(err.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editEntry) throw new Error('編集対象が見つかりません。')
      return updateCashAdjustment(editEntry.id, editDraft)
    },
    onSuccess: async () => {
      await invalidateAll()
      setEditEntry(null)
      setEditMessage('')
    },
    onError: (err: Error) => {
      setEditMessage(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCashAdjustment(id),
    onSuccess: async () => {
      await invalidateAll()
      setEditEntry(null)
      setEditMessage('')
    },
    onError: (err: Error) => {
      setEditMessage(err.message)
    },
  })

  const transferCreateMutation = useMutation({
    mutationFn: () => {
      if (!transferDraft.otherAccountId)
        throw new Error('相手の現金口座を選択してください。')
      if (!transferDraft.amount || Number(transferDraft.amount) <= 0)
        throw new Error('金額は0より大きい値を入力してください。')
      const other = Number(transferDraft.otherAccountId)
      const fromId = transferDraft.direction === 'out' ? account.accountId : other
      const toId = transferDraft.direction === 'out' ? other : account.accountId
      return createTransfer({
        date: transferDraft.date,
        amount: transferDraft.amount,
        fromAccountId: String(fromId),
        toAccountId: String(toId),
        notes: transferDraft.notes,
      })
    },
    onSuccess: async () => {
      await invalidateAll()
      setTransferOpen(false)
      setTransferDraft(emptyTransferDraft(todayString()))
      setTransferMessage('')
    },
    onError: (err: Error) => {
      setTransferMessage(err.message)
    },
  })

  const transferUpdateMutation = useMutation({
    mutationFn: () => {
      if (!editTransfer) throw new Error('編集対象が見つかりません。')
      if (!transferEditDraft.amount || Number(transferEditDraft.amount) <= 0)
        throw new Error('金額は0より大きい値を入力してください。')
      return updateTransfer(editTransfer.id, {
        date: transferEditDraft.date,
        amount: transferEditDraft.amount,
        notes: transferEditDraft.notes,
      })
    },
    onSuccess: async () => {
      await invalidateAll()
      setEditTransfer(null)
      setTransferEditMessage('')
    },
    onError: (err: Error) => {
      setTransferEditMessage(err.message)
    },
  })

  const transferDeleteMutation = useMutation({
    mutationFn: () => {
      if (!editTransfer) throw new Error('削除対象が見つかりません。')
      return deleteTransfer(editTransfer.id)
    },
    onSuccess: async () => {
      await invalidateAll()
      setEditTransfer(null)
      setTransferEditMessage('')
    },
    onError: (err: Error) => {
      setTransferEditMessage(err.message)
    },
  })

  const openTransferEdit = (entry: CashHistoryEntry) => {
    setEditTransfer(entry)
    setTransferEditDraft({
      date: entry.date,
      amount: String(Math.abs(Number(entry.amountSigned))),
      notes: entry.notes ?? '',
    })
    setTransferEditMessage('')
  }

  const submitTransferCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTransferMessage('')
    transferCreateMutation.mutate()
  }

  const submitTransferEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTransferEditMessage('')
    transferUpdateMutation.mutate()
  }

  const openEdit = (entry: CashHistoryEntry) => {
    if (entry.kind !== 'adjustment') return
    setEditEntry(entry)
    const amount = entry.amountSigned.startsWith('-')
      ? entry.amountSigned.slice(1)
      : entry.amountSigned
    setEditDraft({
      date: entry.date,
      direction: entry.direction ?? 'in',
      amount,
      notes: entry.notes ?? '',
    })
    setEditMessage('')
  }

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateMessage('')
    if (!createDraft.amount || Number(createDraft.amount) <= 0) {
      setCreateMessage('金額は0より大きい値を入力してください。')
      return
    }
    createMutation.mutate()
  }

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setEditMessage('')
    if (!editDraft.amount || Number(editDraft.amount) <= 0) {
      setEditMessage('金額は0より大きい値を入力してください。')
      return
    }
    updateMutation.mutate()
  }

  const entries = historyQuery.data ?? []
  const monthLabel = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return month
    const [y, m] = month.split('-')
    return `${y}年${Number(m)}月`
  }, [month])

  return (
    <div className="rounded-[14px] border border-[#e3e9ee] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#0f1c22]">現金の動き</p>
          <p className="text-xs text-[#7a8790]">
            {monthLabel} の入出（振替・支出・人との授受）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
            onClick={() => {
              setTransferDraft(emptyTransferDraft(todayString()))
              setTransferMessage('')
              setTransferOpen(true)
            }}
          >
            現金間の振替
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'primary', size: 'sm', shape: 'pill' })}
            onClick={() => {
              setCreateDraft(emptyDraft(todayString()))
              setCreateMessage('')
              setCreateOpen(true)
            }}
          >
            現金の入出を記録
          </button>
        </div>
      </div>

      {historyQuery.isLoading && (
        <div className="mt-3 rounded-[10px] border border-[#d7dee4] bg-white px-4 py-3 text-sm text-[#5d6a72]">
          読み込み中...
        </div>
      )}
      {historyQuery.isError && (
        <div className="mt-3 rounded-[10px] border border-[#f2b4b4] bg-[#fff1f2] px-4 py-3 text-sm text-[#a33a2b]">
          {historyQuery.error.message}
        </div>
      )}
      {!historyQuery.isLoading && !historyQuery.isError && entries.length === 0 && (
        <div className="mt-3 rounded-[10px] border border-dashed border-[#d7dee4] bg-white px-4 py-3 text-sm text-[#5d6a72]">
          {monthLabel} の現金の動きはまだありません。
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-3 divide-y divide-[#e3e9ee] rounded-[10px] border border-[#e3e9ee] bg-white">
          {entries.map((entry) => {
            const signed = Number(entry.amountSigned)
            const amountClass =
              signed < 0
                ? 'text-[#b23b3b]'
                : signed > 0
                  ? 'text-[#167353]'
                  : 'text-[#0f1c22]'
            const label =
              entry.kind === 'adjustment'
                ? entry.direction === 'in'
                  ? '入金'
                  : '出金'
                : entry.label
            const isAdjOut =
              entry.kind === 'adjustment' && entry.direction === 'out'
            const cap = isAdjOut ? getAdjCapacity(entry) : null
            return (
              <div
                key={`${entry.kind}-${entry.id}`}
                className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center"
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#0f1c22]">{label}</p>
                  <p className="text-xs text-[#5d6a72]">{entry.date}</p>
                  {entry.notes && (
                    <p className="text-xs text-[#7a8790]">{entry.notes}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 md:flex-row md:items-center md:gap-3">
                  <p className={`text-base font-bold ${amountClass}`}>
                    {displayAmount(entry.amountSigned)}
                  </p>
                  {entry.kind === 'adjustment' ? (
                    (() => {
                      const items: DropdownMenuItem[] = []
                      if (isAdjOut && cap && !cap.isFullyAllocated) {
                        items.push({
                          key: 'expense',
                          label: cap.isPartiallyAllocated ? '残りを支出にする' : '支出にする',
                          onSelect: () => openExpenseFromAdj(entry),
                        })
                      }
                      items.push({
                        key: 'edit',
                        label: '編集',
                        onSelect: () => openEdit(entry),
                      })
                      const badge =
                        isAdjOut && cap && cap.linked > 0 ? (
                          <span
                            className="inline-flex items-center rounded-full border border-[#86d19b] bg-[#e6f4ec] px-3 py-1 text-[11px] font-bold text-[#0e4f2c]"
                            title={`登録済 ¥${cap.linked.toLocaleString()} / ¥${cap.total.toLocaleString()}${
                              cap.isPartiallyAllocated ? ` ・残 ¥${cap.remaining.toLocaleString()}` : ''
                            }`}
                          >
                            {cap.isFullyAllocated
                              ? '支出済'
                              : `支出 ¥${cap.linked.toLocaleString()}`}
                            {cap.linkedCount > 1 && (
                              <span className="ml-1 text-[10px]">({cap.linkedCount}件)</span>
                            )}
                          </span>
                        ) : null
                      return (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {badge}
                          {items.length === 1 ? (
                            <button
                              type="button"
                              className={buttonClasses({
                                variant: 'secondary',
                                size: 'xs',
                                shape: 'pill',
                              })}
                              onClick={items[0].onSelect}
                            >
                              {items[0].label}
                            </button>
                          ) : (
                            <DropdownMenu
                              items={items}
                              trigger={({ open, toggle }) => (
                                <button
                                  type="button"
                                  onClick={toggle}
                                  className={buttonClasses({
                                    variant: open ? 'ghost' : 'secondary',
                                    size: 'xs',
                                    shape: 'pill',
                                  })}
                                >
                                  {cap?.isPartiallyAllocated ? '追加' : '紐付け'}
                                  <span aria-hidden className="ml-1 text-[9px]">
                                    ▾
                                  </span>
                                </button>
                              )}
                            />
                          )}
                        </div>
                      )
                    })()
                  ) : entry.kind === 'transfer_in' || entry.kind === 'transfer_out' ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 text-[11px] font-bold text-[#5d6a72]">
                        振替
                      </span>
                      <button
                        type="button"
                        className={buttonClasses({
                          variant: 'secondary',
                          size: 'xs',
                          shape: 'pill',
                        })}
                        onClick={() => openTransferEdit(entry)}
                      >
                        編集
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-3 py-1 text-[11px] font-bold text-[#5d6a72]">
                      支出
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {createOpen && (
        <ModalBackdrop onClose={() => setCreateOpen(false)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">
                  現金の入出を記録
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setCreateOpen(false)}
              >
                閉じる
              </button>
            </div>
            <AdjustmentForm
              draft={createDraft}
              onChange={setCreateDraft}
              onSubmit={submitCreate}
              submitting={createMutation.isPending}
              submitLabel="登録"
              message={createMessage}
            />
          </div>
        </ModalBackdrop>
      )}

      {expenseAdj && (
        <ModalBackdrop onClose={() => setExpenseAdj(null)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">
                  支出にする
                </p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  現金の出金を家計支出として登録します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setExpenseAdj(null)}
              >
                閉じる
              </button>
            </div>
            <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
              <div>日付: {expenseAdj.date}</div>
              <div>金額: {displayAmount(expenseAdj.amountSigned)}</div>
              {(() => {
                const cap = getAdjCapacity(expenseAdj)
                if (cap.linked <= 0) return null
                return (
                  <>
                    <div>既に登録: ¥{cap.linked.toLocaleString()}</div>
                    <div className="text-[#1a7b6d]">
                      残り登録可能: ¥{cap.remaining.toLocaleString()}
                    </div>
                  </>
                )
              })()}
            </div>
            <form className="mt-4 grid gap-3" onSubmit={submitExpense}>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>カテゴリ</span>
                  <CategoryTreeSelect
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    categories={categoriesQuery.data ?? []}
                    value={expenseDraft.categoryId}
                    onChange={(next) =>
                      setExpenseDraft((prev) => ({
                        ...prev,
                        categoryId: next,
                      }))
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
                      max={getAdjCapacity(expenseAdj).remaining || undefined}
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={expenseDraft.amount}
                      onChange={(event) =>
                        setExpenseDraft((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                    <span>日付</span>
                    <input
                      type="date"
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={expenseDraft.date}
                      onChange={(event) =>
                        setExpenseDraft((prev) => ({
                          ...prev,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>備考</span>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={expenseDraft.notes}
                    onChange={(event) =>
                      setExpenseDraft((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="flex items-center justify-end gap-3 pt-1">
                  {expenseMessage && (
                    <span className="text-[0.7rem] text-[#a33a2b]">
                      {expenseMessage}
                    </span>
                  )}
                <button
                  type="submit"
                  disabled={expenseMutation.isPending}
                  className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                >
                  {expenseMutation.isPending ? '登録中...' : '支出として登録'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {editEntry && (
        <ModalBackdrop onClose={() => setEditEntry(null)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">
                  現金の入出を編集
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setEditEntry(null)}
              >
                閉じる
              </button>
            </div>
            <AdjustmentForm
              draft={editDraft}
              onChange={setEditDraft}
              onSubmit={submitEdit}
              submitting={updateMutation.isPending}
              submitLabel="更新"
              message={editMessage}
              extra={
                <button
                  type="button"
                  className={buttonClasses({ variant: 'danger', size: 'sm', shape: 'pill' })}
                  onClick={() => {
                    if (!editEntry) return
                    if (!window.confirm('この入出記録を削除しますか？')) return
                    deleteMutation.mutate(editEntry.id)
                  }}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? '削除中...' : '削除'}
                </button>
              }
            />
          </div>
        </ModalBackdrop>
      )}

      {transferOpen && (
        <ModalBackdrop onClose={() => setTransferOpen(false)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">現金間の振替</p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  別の現金口座との資金移動を記録します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setTransferOpen(false)}
              >
                閉じる
              </button>
            </div>
            <form className="mt-4 grid gap-3" onSubmit={submitTransferCreate}>
              <div className="grid gap-1.5">
                <span className="text-xs font-semibold text-[#0f1c22]">方向</span>
                <div className="flex gap-2">
                  {([
                    ['in', '入金'],
                    ['out', '出金'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setTransferDraft((prev) => ({ ...prev, direction: value }))
                      }
                      className={`flex-1 rounded-full border px-3 py-2 text-xs font-bold transition ${
                        transferDraft.direction === value
                          ? value === 'in'
                            ? 'border-[#157665] bg-[#e6f4ec] text-[#0e4f2c]'
                            : 'border-[#d7707a] bg-[#fff1f2] text-[#7f1d1d]'
                          : 'border-[#d7dee4] bg-white text-[#0f1c22]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>
                  {transferDraft.direction === 'out' ? '移動先 (現金口座)' : '移動元 (現金口座)'}
                </span>
                <select
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={transferDraft.otherAccountId}
                  onChange={(event) =>
                    setTransferDraft((prev) => ({
                      ...prev,
                      otherAccountId: event.target.value,
                    }))
                  }
                >
                  <option value="">
                    {paymentAccountsQuery.isLoading
                      ? '読み込み中...'
                      : otherCashWallets.length === 0
                        ? '他の現金口座がありません'
                        : '選択してください'}
                  </option>
                  {otherCashWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>金額</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={transferDraft.amount}
                    onChange={(event) =>
                      setTransferDraft((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>日付</span>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={transferDraft.date}
                    onChange={(event) =>
                      setTransferDraft((prev) => ({ ...prev, date: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>備考 (任意)</span>
                <input
                  type="text"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={transferDraft.notes}
                  onChange={(event) =>
                    setTransferDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <div className="flex items-center justify-end gap-3 pt-1">
                {transferMessage && (
                  <span className="text-[0.7rem] text-[#a33a2b]">{transferMessage}</span>
                )}
                <button
                  type="submit"
                  disabled={transferCreateMutation.isPending}
                  className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                >
                  {transferCreateMutation.isPending ? '登録中...' : '登録'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {editTransfer && (
        <ModalBackdrop onClose={() => setEditTransfer(null)}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#0d2b32]">振替を編集</p>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  {editTransfer.otherAccountName
                    ? `${editTransfer.otherAccountName} との振替`
                    : '現金間の振替'}
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => setEditTransfer(null)}
              >
                閉じる
              </button>
            </div>
            <form className="mt-4 grid gap-3" onSubmit={submitTransferEdit}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>金額</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={transferEditDraft.amount}
                    onChange={(event) =>
                      setTransferEditDraft((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>日付</span>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={transferEditDraft.date}
                    onChange={(event) =>
                      setTransferEditDraft((prev) => ({ ...prev, date: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                <span>備考 (任意)</span>
                <input
                  type="text"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                  value={transferEditDraft.notes}
                  onChange={(event) =>
                    setTransferEditDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                {transferEditMessage && (
                  <span className="text-[0.7rem] text-[#a33a2b]">{transferEditMessage}</span>
                )}
                <button
                  type="button"
                  className={buttonClasses({ variant: 'danger', size: 'sm', shape: 'pill' })}
                  disabled={transferDeleteMutation.isPending}
                  onClick={() => {
                    if (!window.confirm('この振替を削除しますか？')) return
                    transferDeleteMutation.mutate()
                  }}
                >
                  {transferDeleteMutation.isPending ? '削除中...' : '削除'}
                </button>
                <button
                  type="submit"
                  disabled={transferUpdateMutation.isPending}
                  className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                >
                  {transferUpdateMutation.isPending ? '更新中...' : '更新'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </div>
  )
}

type FormProps = {
  draft: AdjustmentDraft
  onChange: (next: AdjustmentDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitting: boolean
  submitLabel: string
  message: string
  extra?: ReactNode
}

function AdjustmentForm({
  draft,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  message,
  extra,
}: FormProps) {
  return (
    <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold text-[#0f1c22]">方向</span>
        <div className="flex gap-2">
          {([
            ['in', '入金'],
            ['out', '出金'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...draft, direction: value })}
              className={`flex-1 rounded-full border px-3 py-2 text-xs font-bold transition ${
                draft.direction === value
                  ? value === 'in'
                    ? 'border-[#157665] bg-[#e6f4ec] text-[#0e4f2c]'
                    : 'border-[#d7707a] bg-[#fff1f2] text-[#7f1d1d]'
                  : 'border-[#d7dee4] bg-white text-[#0f1c22]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
          <span>金額</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
            value={draft.amount}
            onChange={(event) =>
              onChange({ ...draft, amount: event.target.value })
            }
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
          <span>日付</span>
          <input
            type="date"
            className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
            value={draft.date}
            onChange={(event) =>
              onChange({ ...draft, date: event.target.value })
            }
          />
        </label>
      </div>
      <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
        <span>備考 (任意)</span>
        <input
          type="text"
          className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
        {message && <span className="text-[0.7rem] text-[#a33a2b]">{message}</span>}
        {extra}
        <button
          type="submit"
          disabled={submitting}
          className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
        >
          {submitting ? '保存中...' : submitLabel}
        </button>
      </div>
    </form>
  )
}


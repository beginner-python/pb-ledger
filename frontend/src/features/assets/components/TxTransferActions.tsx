import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { buttonClasses } from '../../../ui/button'
import { fetchPaymentAccounts } from '../../household/services/household'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import {
  createTransfer,
  deleteTransfer,
  updateTransfer,
} from '../services/transfers'
import { fetchAccountTransactions } from '../services/transactions'
import type { AccountTransaction, AssetAccount } from '../types/types'

export type TxTransferTriggerState = {
  isBank: boolean
  isLinked: boolean
  isExpenseLinked: boolean
  direction: 'out' | 'in'
  otherAccountName: string | null
  openCreate: () => void
  openEdit: () => void
}

type Props = {
  tx: AccountTransaction
  account: AssetAccount
  displayAmount: (value: number | string | null | undefined) => string
  children?: (state: TxTransferTriggerState) => ReactNode
}

type Mode = 'idle' | 'create' | 'edit'

type CreateDraft = {
  otherAccountId: string
  amount: string
  date: string
  notes: string
}

type EditDraft = CreateDraft

const PAYMENT_KIND_LABELS: Record<string, string> = {
  bank_account: '銀行',
  credit_card: 'カード',
  cash: '現金',
}

const toNumber = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v
  return Number.isNaN(n) ? 0 : n
}

export default function TxTransferActions({
  tx,
  account,
  displayAmount,
  children,
}: Props) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('idle')
  const [message, setMessage] = useState('')

  const amount = toNumber(tx.amount)
  // 銀行明細起点。amount < 0 (出金) なら銀行→現金、amount > 0 (入金) なら現金→銀行。
  const direction: 'out' | 'in' = amount < 0 ? 'out' : 'in'
  const txAmountAbs = Math.abs(amount)

  const isLinked = Boolean(tx.linkedTransferId)
  const isExpenseLinked = (tx.linkedExpenseCount ?? 0) > 0
  // 銀行口座のみ対象。クレカは現状対象外
  const isBank = account.assetKind === 'bank_account'

  const paymentAccountsQuery = useQuery({
    queryKey: ['ledger', 'payment-accounts'],
    queryFn: fetchPaymentAccounts,
    staleTime: 30_000,
    enabled: isBank && (mode === 'create' || mode === 'edit'),
  })

  // 相手口座は自口座以外のすべての支払手段（銀行・カード・現金）。
  const otherAccounts = useMemo(
    () => (paymentAccountsQuery.data ?? []).filter((a) => a.id !== account.accountId),
    [paymentAccountsQuery.data, account.accountId]
  )

  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    otherAccountId: '',
    amount: String(txAmountAbs || ''),
    date: tx.date,
    notes: '',
  })
  const editDraftFromTx = (): EditDraft => ({
    otherAccountId: tx.linkedTransferOtherAccountId
      ? String(tx.linkedTransferOtherAccountId)
      : '',
    amount: tx.linkedTransferAmount ?? '',
    date: tx.linkedTransferDate ?? tx.date,
    notes: tx.linkedTransferNotes ?? '',
  })
  const [editDraft, setEditDraft] = useState<EditDraft>(editDraftFromTx)
  // 作成時に紐付ける相手側の明細（相手が銀行口座のときのみ表示）
  const [createOtherTxId, setCreateOtherTxId] = useState<string>('')

  const selectedOtherAccount = useMemo(
    () => otherAccounts.find((a) => String(a.id) === createDraft.otherAccountId) ?? null,
    [otherAccounts, createDraft.otherAccountId]
  )
  // 相手が明細を持つ口座（銀行）のときだけ、相手側明細を紐付け可能にする。
  const otherIsBank = selectedOtherAccount?.kind === 'bank_account'
  const counterpartMonth = tx.date.slice(0, 7)

  const otherTxQuery = useQuery({
    queryKey: ['transactions', 'transfer-pick', createDraft.otherAccountId, counterpartMonth],
    queryFn: () => fetchAccountTransactions(createDraft.otherAccountId, counterpartMonth),
    enabled:
      isBank && mode === 'create' && otherIsBank && Boolean(createDraft.otherAccountId),
    staleTime: 15_000,
  })

  // 起点が出金なら相手は入金明細、起点が入金なら相手は出金明細。未紐付けのみ候補に。
  const counterpartTxs = useMemo(() => {
    const list = otherTxQuery.data ?? []
    return list.filter((t) => {
      const amt = toNumber(t.amount)
      const signOk = direction === 'out' ? amt > 0 : amt < 0
      if (!signOk) return false
      // 支出紐付け済みは対象外。
      if ((t.linkedExpenseCount ?? 0) > 0) return false
      // 未紐付け（新規作成）か、片側だけ埋まった振替の完成待ち（反対側が空）なら候補。
      if (!t.linkedTransferId) return true
      return Boolean(t.linkedTransferOppositeFree)
    })
  }, [otherTxQuery.data, direction])

  const selectedCounterpartTx = useMemo(
    () => counterpartTxs.find((t) => String(t.id) === createOtherTxId) ?? null,
    [counterpartTxs, createOtherTxId]
  )

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['balance'] }),
      queryClient.invalidateQueries({ queryKey: ['ledger', 'cash-history'] }),
      queryClient.invalidateQueries({ queryKey: ['ledger', 'transfers'] }),
    ])
  }

  const openCreate = () => {
    setCreateDraft({
      otherAccountId: '',
      amount: String(txAmountAbs || ''),
      date: tx.date,
      notes: '',
    })
    setCreateOtherTxId('')
    setMessage('')
    setMode('create')
  }

  const openEdit = () => {
    setEditDraft(editDraftFromTx())
    setMessage('')
    setMode('edit')
  }

  const close = () => {
    setMode('idle')
    setMessage('')
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const other = createDraft.otherAccountId
      if (!other) throw new Error('移動先を選択してください。')
      if (!createDraft.amount || Number(createDraft.amount) <= 0)
        throw new Error('金額は0より大きい値を入力してください。')
      const fromId = direction === 'out' ? account.accountId : Number(other)
      const toId = direction === 'out' ? Number(other) : account.accountId
      const picked = otherIsBank ? selectedCounterpartTx : null
      // 選んだ相手明細が片側だけの振替に属するなら、新規作成せずその振替を完成させる。
      if (picked?.linkedTransferId) {
        return updateTransfer(picked.linkedTransferId, {
          ...(direction === 'out'
            ? { fromTransactionId: tx.id }
            : { toTransactionId: tx.id }),
        })
      }
      // 相手が銀行で未紐付け明細を選んだ場合は反対側も紐付け、両明細を収支から除外する。
      const otherTxId = picked ? String(picked.id) : undefined
      return createTransfer({
        date: createDraft.date,
        amount: createDraft.amount,
        fromAccountId: String(fromId),
        toAccountId: String(toId),
        notes: createDraft.notes,
        ...(direction === 'out'
          ? { fromTransactionId: String(tx.id), toTransactionId: otherTxId }
          : { toTransactionId: String(tx.id), fromTransactionId: otherTxId }),
      })
    },
    onSuccess: async () => {
      await invalidate()
      close()
    },
    onError: (err: Error) => setMessage(err.message),
  })

  const editMutation = useMutation({
    mutationFn: () => {
      if (!tx.linkedTransferId) throw new Error('紐付けが見つかりません。')
      if (!editDraft.otherAccountId)
        throw new Error('相手口座を選択してください。')
      if (!editDraft.amount || Number(editDraft.amount) <= 0)
        throw new Error('金額は0より大きい値を入力してください。')
      return updateTransfer(tx.linkedTransferId, {
        date: editDraft.date,
        amount: editDraft.amount,
        notes: editDraft.notes,
        ...(direction === 'out'
          ? { toAccountId: Number(editDraft.otherAccountId) }
          : { fromAccountId: Number(editDraft.otherAccountId) }),
      })
    },
    onSuccess: async () => {
      await invalidate()
      close()
    },
    onError: (err: Error) => setMessage(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!tx.linkedTransferId) throw new Error('紐付けが見つかりません。')
      return deleteTransfer(tx.linkedTransferId)
    },
    onSuccess: async () => {
      await invalidate()
      close()
    },
    onError: (err: Error) => setMessage(err.message),
  })

  const triggerState: TxTransferTriggerState = {
    isBank,
    isLinked,
    isExpenseLinked,
    direction,
    otherAccountName: tx.linkedTransferOtherAccountName ?? null,
    openCreate,
    openEdit,
  }

  const defaultTrigger = !isBank ? null : isLinked ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center rounded-full border border-[#157665] bg-[#eaf5ef] px-3 py-1 text-[11px] font-bold text-[#0e4f2c]">
        {tx.linkedTransferOtherAccountName ?? '振替'}
        {direction === 'out' ? ' へ移動済' : ' から入金済'}
      </span>
      <button
        type="button"
        className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
        onClick={openEdit}
      >
        編集
      </button>
    </div>
  ) : !isExpenseLinked ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
        onClick={openCreate}
      >
        {direction === 'out' ? '別口座へ移動' : '別口座から入金'}
      </button>
    </div>
  ) : null

  const modals = !isBank ? null : (
    <>
      {(mode === 'create' || mode === 'edit') && (
        <ModalBackdrop onClose={close}>
          <div className="w-full max-w-[520px] rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-[#0d2b32]">
                  {mode === 'create'
                    ? direction === 'out'
                      ? '別口座へ移動'
                      : '別口座から入金'
                    : '振替を編集'}
                </p>
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                  onClick={close}
                >
                  閉じる
                </button>
              </div>
              <div className="mt-3 rounded-2xl border border-[#e3e9ee] bg-[#f9fbfc] p-3 text-xs text-[#5d6a72]">
                <div>明細日: {tx.date}</div>
                <div>明細金額: {displayAmount(tx.amount)}</div>
                {tx.description && <div>内容: {tx.description}</div>}
              </div>
              <form
                className="mt-4 grid gap-3"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  setMessage('')
                  if (mode === 'create') createMutation.mutate()
                  else editMutation.mutate()
                }}
              >
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>{direction === 'out' ? '移動先' : '移動元'}</span>
                  <select
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={
                      mode === 'create'
                        ? createDraft.otherAccountId
                        : editDraft.otherAccountId
                    }
                    onChange={(event) => {
                      const v = event.target.value
                      if (mode === 'create') {
                        setCreateDraft((prev) => ({ ...prev, otherAccountId: v }))
                        setCreateOtherTxId('')
                      } else setEditDraft((prev) => ({ ...prev, otherAccountId: v }))
                    }}
                  >
                    <option value="">選択してください</option>
                    {otherAccounts.map((w) => (
                      <option key={w.id} value={w.id}>
                        [{PAYMENT_KIND_LABELS[w.kind] ?? w.kind}] {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                {mode === 'create' && otherIsBank && (
                  <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                    <span>{direction === 'out' ? '移動先の明細 (任意)' : '移動元の明細 (任意)'}</span>
                    <select
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={createOtherTxId}
                      onChange={(event) => setCreateOtherTxId(event.target.value)}
                    >
                      <option value="">
                        {otherTxQuery.isLoading
                          ? '読み込み中...'
                          : counterpartTxs.length === 0
                            ? '紐付け可能な明細がありません'
                            : '未指定'}
                      </option>
                      {counterpartTxs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.date} · {t.description || '取引'} · {displayAmount(t.amount)}
                          {t.linkedTransferId ? ' · 既存の振替を完成' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                    <span>金額</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={mode === 'create' ? createDraft.amount : editDraft.amount}
                      onChange={(event) => {
                        const v = event.target.value
                        if (mode === 'create')
                          setCreateDraft((prev) => ({ ...prev, amount: v }))
                        else setEditDraft((prev) => ({ ...prev, amount: v }))
                      }}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                    <span>日付</span>
                    <input
                      type="date"
                      className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                      value={mode === 'create' ? createDraft.date : editDraft.date}
                      onChange={(event) => {
                        const v = event.target.value
                        if (mode === 'create')
                          setCreateDraft((prev) => ({ ...prev, date: v }))
                        else setEditDraft((prev) => ({ ...prev, date: v }))
                      }}
                    />
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-semibold text-[#0f1c22]">
                  <span>備考 (任意)</span>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22]"
                    value={mode === 'create' ? createDraft.notes : editDraft.notes}
                    onChange={(event) => {
                      const v = event.target.value
                      if (mode === 'create')
                        setCreateDraft((prev) => ({ ...prev, notes: v }))
                      else setEditDraft((prev) => ({ ...prev, notes: v }))
                    }}
                  />
                </label>
                <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                  {message && (
                    <span className="text-[0.7rem] text-[#a33a2b]">{message}</span>
                  )}
                  {mode === 'edit' && (
                    <button
                      type="button"
                      className={buttonClasses({ variant: 'danger', size: 'sm', shape: 'pill' })}
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (!window.confirm('この振替を削除しますか？')) return
                        deleteMutation.mutate()
                      }}
                    >
                      振替を削除
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={
                      mode === 'create'
                        ? createMutation.isPending
                        : editMutation.isPending
                    }
                    className={buttonClasses({ variant: 'primary', size: 'md', shape: 'pill' })}
                  >
                    {mode === 'create'
                      ? createMutation.isPending
                        ? '登録中...'
                        : '登録'
                      : editMutation.isPending
                        ? '更新中...'
                        : '更新'}
                  </button>
                </div>
              </form>
            </div>
          </ModalBackdrop>
      )}

    </>
  )

  return (
    <>
      {children ? children(triggerState) : defaultTrigger}
      {modals}
    </>
  )
}

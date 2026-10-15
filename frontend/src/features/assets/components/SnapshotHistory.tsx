import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { authFetcher } from '../../../api/client'
import type {
  AssetAccount,
  AssetSnapshot,
  SnapshotListResult,
  SnapshotMutationResult,
} from '../types/types'
import { buttonClasses } from '../../../ui/button'

type SnapshotHistoryProps = {
  selectedAccount: AssetAccount
  displayAmount: (value: number | string | null | undefined) => string
  onChanged: () => Promise<void>
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

type EditForm = {
  asOf: string
  balance: string
  notes: string
}

const parseJsonSafely = async (res: Response) => {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

export default function SnapshotHistory({
  selectedAccount,
  displayAmount,
  onChanged,
  statusClassName,
}: SnapshotHistoryProps) {
  const [editingSnapshotId, setEditingSnapshotId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    asOf: '',
    balance: '',
    notes: '',
  })
  const [message, setMessage] = useState<string>('')
  const [messageStatus, setMessageStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const amountLabel = selectedAccount.assetKind === 'financial_asset' ? '評価額' : '残高'

  const snapshotsQuery = useQuery<AssetSnapshot[], Error>({
    queryKey: ['asset-snapshots', selectedAccount.assetKind, selectedAccount.accountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        assetKind: selectedAccount.assetKind,
        accountId: String(selectedAccount.accountId),
      })
      const res = await authFetcher(`/api/ledger/snapshots/?${params.toString()}`)
      const data: SnapshotListResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || 'スナップショット履歴の取得に失敗しました。')
      }
      return data.snapshots ?? []
    },
    staleTime: 0,
  })

  const refetchSnapshots = snapshotsQuery.refetch

  const updateSnapshotMutation = useMutation<SnapshotMutationResult, Error, number>({
    mutationFn: async (snapshotId: number) => {
      const res = await authFetcher(
        `/api/ledger/snapshots/${snapshotId}/?assetKind=${selectedAccount.assetKind}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asOf: editForm.asOf,
            balance: editForm.balance,
            notes: editForm.notes,
          }),
        }
      )
      const data: SnapshotMutationResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || 'スナップショットの更新に失敗しました。')
      }
      return data
    },
    onSuccess: async () => {
      setEditingSnapshotId(null)
      setMessage('スナップショットを更新しました。')
      setMessageStatus('success')
      await Promise.all([refetchSnapshots(), onChanged()])
    },
    onError: (error) => {
      setMessage(error.message || 'スナップショットの更新に失敗しました。')
      setMessageStatus('error')
    },
  })

  const deleteSnapshotMutation = useMutation<SnapshotMutationResult, Error, number>({
    mutationFn: async (snapshotId: number) => {
      const res = await authFetcher(
        `/api/ledger/snapshots/${snapshotId}/?assetKind=${selectedAccount.assetKind}`,
        { method: 'DELETE' }
      )
      const data: SnapshotMutationResult = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(data.error || 'スナップショットの削除に失敗しました。')
      }
      return data
    },
    onSuccess: async () => {
      setEditingSnapshotId(null)
      setMessage('スナップショットを削除しました。')
      setMessageStatus('success')
      await Promise.all([refetchSnapshots(), onChanged()])
    },
    onError: (error) => {
      setMessage(error.message || 'スナップショットの削除に失敗しました。')
      setMessageStatus('error')
    },
  })

  const startEditing = (snapshot: AssetSnapshot) => {
    setEditingSnapshotId(snapshot.id)
    setEditForm({
      asOf: snapshot.asOf,
      balance: String(snapshot.balance),
      notes: snapshot.notes,
    })
    setMessage('')
    setMessageStatus('idle')
  }

  const cancelEditing = () => {
    setEditingSnapshotId(null)
    setEditForm({ asOf: '', balance: '', notes: '' })
  }

  const handleDelete = async (snapshot: AssetSnapshot) => {
    const confirmed = window.confirm(
      `${snapshot.asOf} のスナップショットを削除します。よろしいですか？`
    )
    if (!confirmed) return
    await deleteSnapshotMutation.mutateAsync(snapshot.id)
  }

  const snapshots = snapshotsQuery.data ?? []
  const isMutating = updateSnapshotMutation.isPending || deleteSnapshotMutation.isPending

  return (
    <section className="grid gap-4">
      {snapshotsQuery.status === 'pending' && (
        <div className={`rounded-[10px] px-4 py-3 text-sm ${statusClassName('loading')}`}>
          スナップショット履歴を読み込んでいます...
        </div>
      )}
      {snapshotsQuery.status === 'error' && (
        <div className={`rounded-[10px] px-4 py-3 text-sm ${statusClassName('error')}`}>
          {snapshotsQuery.error?.message || 'スナップショット履歴の取得に失敗しました。'}
        </div>
      )}
      {message && messageStatus !== 'idle' && (
        <div
          className={`rounded-[10px] px-4 py-3 text-sm ${statusClassName(
            messageStatus === 'success' ? 'success' : 'error'
          )}`}
        >
          {message}
        </div>
      )}
      {snapshotsQuery.status === 'success' && snapshots.length === 0 && (
        <div className="rounded-[12px] border border-dashed border-[#d7dee4] bg-[#f8fafb] p-4 text-sm text-[#5d6a72]">
          スナップショットはまだ登録されていません。
        </div>
      )}
      {snapshots.length > 0 && (
        <div className="divide-y divide-[#e3e9ee] rounded-[12px] border border-[#e3e9ee] bg-white">
          {snapshots.map((snapshot) => {
            const isEditing = editingSnapshotId === snapshot.id
            return (
              <div key={snapshot.id} className="grid gap-3 p-4">
                {isEditing ? (
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void updateSnapshotMutation.mutateAsync(snapshot.id)
                    }}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                        <span>日付</span>
                        <input
                          type="date"
                          value={editForm.asOf}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, asOf: event.target.value }))
                          }
                          className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                        <span>{amountLabel}</span>
                        <input
                          type="number"
                          step="1"
                          inputMode="decimal"
                          value={editForm.balance}
                          onChange={(event) =>
                            setEditForm((prev) => ({
                              ...prev,
                              balance: event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                      <span>備考</span>
                      <textarea
                        value={editForm.notes}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        rows={2}
                        className="w-full resize-none rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                      />
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isMutating}
                        className={buttonClasses({
                          variant: 'secondary',
                          size: 'sm',
                          shape: 'rounded',
                          className: 'text-xs font-bold',
                        })}
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        disabled={isMutating}
                        className={buttonClasses({
                          variant: 'primary',
                          size: 'sm',
                          shape: 'rounded',
                          className: 'text-xs font-bold',
                        })}
                      >
                        {updateSnapshotMutation.isPending ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-bold text-[#0f1c22]">{snapshot.asOf}</p>
                      <p className="mt-1 text-xl font-extrabold text-[#145e52]">
                        {displayAmount(snapshot.balance)}
                      </p>
                      {snapshot.notes && (
                        <p className="mt-1 text-xs text-[#7a8790]">{snapshot.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEditing(snapshot)}
                        disabled={isMutating}
                        className={buttonClasses({
                          variant: 'secondary',
                          size: 'sm',
                          shape: 'rounded',
                          className: 'text-xs font-bold',
                        })}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(snapshot)}
                        disabled={isMutating}
                        className="rounded-full border border-[#d9a7a7] bg-white px-3 py-1.5 text-xs font-bold text-[#8d3f3f] transition hover:-translate-y-0.5 hover:bg-[#fff5f5] hover:shadow-[0_10px_24px_rgba(127,29,29,0.14)] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {deleteSnapshotMutation.isPending ? '削除中...' : '削除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

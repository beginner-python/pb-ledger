import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { AssetAccount } from '../types/types'
import { authFetcher } from '../../../api/client'

type Props = {
  account: AssetAccount
  supportsCsv: boolean
  statusClassName: (status: 'loading' | 'success' | 'error') => string
  /** 保存後に呼ぶ。親は口座一覧を再取得する */
  onSaved: () => Promise<void>
}

/** 明細のダウンロード元や資産ページの URL を保存する */
export default function ReferenceUrlPanel({ account, supportsCsv, statusClassName, onSaved }: Props) {
  const [referenceUrlDraft, setReferenceUrlDraft] = useState<string>(account.referenceUrl ?? '')
  const [referenceUrlStatus, setReferenceUrlStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  )
  const [referenceUrlMessage, setReferenceUrlMessage] = useState<string>('')

  const saveReferenceUrlMutation = useMutation<{ referenceUrl?: string }, Error, string>({
    mutationFn: async (referenceUrl: string) => {
      const res = await authFetcher(
        `/api/ledger/accounts/${account.accountId}/?assetKind=${account.assetKind}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceUrl }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'URLの保存に失敗しました。')
      }
      return data
    },
    onMutate: () => {
      setReferenceUrlStatus('loading')
      setReferenceUrlMessage('')
    },
    onSuccess: async () => {
      await onSaved()
      setReferenceUrlStatus('success')
      setReferenceUrlMessage('URLを保存しました。')
    },
    onError: (error) => {
      setReferenceUrlStatus('error')
      setReferenceUrlMessage(error.message || 'URLの保存に失敗しました。')
    },
  })

  const referenceUrlSavedValue = account.referenceUrl ?? ''
  const referenceUrlIsDirty = referenceUrlDraft.trim() !== referenceUrlSavedValue
  const referenceUrlIsValid = (() => {
    const trimmed = referenceUrlDraft.trim()
    if (!trimmed) return true
    try {
      const parsed = new URL(trimmed)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  })()

  const handleReferenceUrlSave = () => {
    const trimmed = referenceUrlDraft.trim()
    if (trimmed && !referenceUrlIsValid) {
      setReferenceUrlStatus('error')
      setReferenceUrlMessage('http(s) で始まる有効なURLを入力してください。')
      return
    }
    saveReferenceUrlMutation.mutate(trimmed)
  }


  return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[#7a8790]">
          {supportsCsv
            ? 'CSVをダウンロードする明細ページのURLを保存できます。'
            : '評価額を確認できるページのURLを保存できます。'}
        </p>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            type="url"
            value={referenceUrlDraft}
            onChange={(event) => setReferenceUrlDraft(event.target.value)}
            placeholder="https://..."
            className="min-w-0 flex-1 rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-sm text-[#0f1c22]"
          />
          <button
            type="button"
            onClick={handleReferenceUrlSave}
            disabled={referenceUrlStatus === 'loading' || !referenceUrlIsDirty}
            className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
              referenceUrlStatus === 'loading' || !referenceUrlIsDirty
                ? 'cursor-not-allowed border-[#d7dee4] bg-[#f3f5f7] text-[#9aa6ad]'
                : 'border-[#1a7b6d] bg-[#1a7b6d] text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)] hover:-translate-y-0.5'
            }`}
          >
            {referenceUrlStatus === 'loading' ? '保存中...' : '保存'}
          </button>
        </div>
        {referenceUrlSavedValue && (
          <a
            href={referenceUrlSavedValue}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start rounded-full border border-[#1a7b6d] bg-[#1a7b6d] px-3 py-1.5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(26,123,109,0.28)] transition hover:-translate-y-0.5"
          >
            {supportsCsv ? 'ダウンロードページを開く' : 'ページを開く'}
          </a>
        )}
        {referenceUrlMessage && referenceUrlStatus !== 'idle' && referenceUrlStatus !== 'loading' && (
          <div
            className={`rounded-[10px] px-4 py-3 text-sm ${statusClassName(
              referenceUrlStatus === 'success' ? 'success' : 'error'
            )}`}
          >
            {referenceUrlMessage}
          </div>
        )}
      </div>
  )
}

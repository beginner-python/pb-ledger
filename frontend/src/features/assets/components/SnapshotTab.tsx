import type { FormEvent } from 'react'
import { buttonClasses } from '../../../ui/button'

type SnapshotTabProps = {
  snapshotStatus: 'idle' | 'loading' | 'success' | 'error'
  snapshotMessage: string
  onSubmit: (event: FormEvent) => void
  snapshotDate: string
  snapshotBalance: string
  snapshotNotes: string
  amountLabel?: string
  onSnapshotDateChange: (value: string) => void
  onSnapshotBalanceChange: (value: string) => void
  onSnapshotNotesChange: (value: string) => void
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

export default function SnapshotTab({
  snapshotStatus,
  snapshotMessage,
  onSubmit,
  snapshotDate,
  snapshotBalance,
  snapshotNotes,
  amountLabel = '残高',
  onSnapshotDateChange,
  onSnapshotBalanceChange,
  onSnapshotNotesChange,
  statusClassName,
}: SnapshotTabProps) {
  return (
    <section className="flex min-h-[360px] w-full flex-col gap-4 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 font-semibold text-[#0f1c22]">
            <span>日付</span>
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => onSnapshotDateChange(e.target.value)}
              className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
            />
          </label>
          <label className="flex flex-col gap-1.5 font-semibold text-[#0f1c22]">
            <span>{amountLabel}</span>
            <input
              type="number"
              step="1"
              inputMode="decimal"
              value={snapshotBalance}
              onChange={(e) => onSnapshotBalanceChange(e.target.value)}
              placeholder="例: 10500"
              className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 font-semibold text-[#0f1c22]">
          <span>備考 (任意)</span>
          <textarea
            value={snapshotNotes}
            onChange={(e) => onSnapshotNotesChange(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={snapshotStatus === 'loading'}
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              shape: 'rounded',
              className: 'px-5 py-3 font-bold',
            })}
          >
            {snapshotStatus === 'loading' ? '登録中...' : 'スナップショット登録'}
          </button>
        </div>
      </form>

      {snapshotMessage && snapshotStatus !== 'idle' && (
        <div
          className={`mt-2 rounded-[10px] px-4 py-3 text-sm backdrop-blur-sm ${statusClassName(
            snapshotStatus === 'loading'
              ? 'loading'
              : snapshotStatus === 'success'
                ? 'success'
                : 'error'
          )}`}
        >
          <p>{snapshotMessage}</p>
        </div>
      )}
    </section>
  )
}

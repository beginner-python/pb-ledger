import type { FormEvent } from 'react'
import { useRef } from 'react'
import { buttonClasses } from '../../../ui/button'

type ImportTabProps = {
  uploadStatus: 'idle' | 'loading' | 'success' | 'error'
  uploadMessage: string
  fileName: string
  onFileChange: (file: File | null) => void
  onSubmit: (event: FormEvent) => void
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

export default function ImportTab({
  uploadStatus,
  uploadMessage,
  fileName,
  onFileChange,
  onSubmit,
  statusClassName,
}: ImportTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <section className="flex min-h-[360px] w-full flex-col gap-4 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-6 shadow-[0_18px_42px_rgba(16,38,49,0.16)] backdrop-blur-sm">
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-1.5 font-semibold text-[#0f1c22]">
          <span>CSV ファイル</span>
          <div
            className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#9bb3bf] bg-[#f7fbfb] px-4 py-5 text-[#0f1c22] transition duration-150 hover:border-[#1a7b6d] hover:bg-[#f1faf8]"
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              onFileChange(event.dataTransfer.files?.[0] ?? null)
            }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={buttonClasses({
                variant: 'primary',
                size: 'lg',
                shape: 'rounded',
                className: 'rounded-lg px-5 py-2.5 text-sm font-semibold',
              })}
            >
              ファイルを選択
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV ファイルを選択"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            {fileName ? (
              <span className="max-w-full truncate rounded-full bg-[#e7f3ef] px-3 py-1 text-sm font-medium text-[#1b3b33]">
                {fileName}
              </span>
            ) : (
              <span className="text-sm text-[#5d6a72]">ドラッグ&ドロップもできます</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={uploadStatus === 'loading'}
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              shape: 'rounded',
              className: 'px-5 py-3 font-bold',
            })}
          >
            {uploadStatus === 'loading' ? 'アップロード中...' : 'アップロードして登録'}
          </button>
        </div>
      </form>

      {uploadMessage && uploadStatus !== 'idle' && (
        <div
          className={`mt-2 rounded-[10px] px-4 py-3 text-sm backdrop-blur-sm ${statusClassName(
            uploadStatus === 'loading'
              ? 'loading'
              : uploadStatus === 'success'
                ? 'success'
                : 'error'
          )}`}
        >
          <p>{uploadMessage}</p>
        </div>
      )}
    </section>
  )
}

import type { FormEvent } from 'react'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'
import type { AssetAccount, AssetKind } from '../types/types'

type AccountCreatePanelProps = {
  isOpen: boolean
  onToggle: () => void
  onSubmit: (event: FormEvent) => void
  status: 'idle' | 'loading' | 'success' | 'error'
  message: string
  assetKind: AssetKind
  name: string
  branchName: string
  accountNumber: string
  issuer: string
  last4: string
  closingDay: string
  paymentDay: string
  paymentDestinationId: string
  bankAccountOptions: AssetAccount[]
  onNameChange: (value: string) => void
  onBranchNameChange: (value: string) => void
  onAccountNumberChange: (value: string) => void
  onIssuerChange: (value: string) => void
  onLast4Change: (value: string) => void
  onClosingDayChange: (value: string) => void
  onPaymentDayChange: (value: string) => void
  onPaymentDestinationIdChange: (value: string) => void
  statusClassName: (status: 'loading' | 'success' | 'error') => string
}

const TITLES: Record<AssetKind, { title: string; description: string; submit: string; nameLabel: string; placeholder: string }> = {
  bank_account: {
    title: '銀行口座の追加',
    description: '銀行口座の情報を入力してください。',
    submit: '銀行口座を作成',
    nameLabel: '口座名',
    placeholder: '例: 給与口座',
  },
  credit_card: {
    title: 'クレジットカードの追加',
    description: 'カード情報と引落先を設定すると、明細インポート時に連携できます。',
    submit: 'カードを作成',
    nameLabel: 'カード名',
    placeholder: '例: メインカード',
  },
  cash: {
    title: '現金（財布）の追加',
    description: '現金管理の単位を入力してください。',
    submit: '現金を作成',
    nameLabel: '名前',
    placeholder: '例: メイン財布',
  },
  financial_asset: {
    title: '金融資産の追加',
    description: '金融資産の名前を入力してください。',
    submit: '金融資産を作成',
    nameLabel: '名前',
    placeholder: '例: NISA',
  },
}

export default function AccountCreatePanel({
  isOpen,
  onToggle,
  onSubmit,
  status,
  message,
  assetKind,
  name,
  branchName,
  accountNumber,
  issuer,
  last4,
  closingDay,
  paymentDay,
  paymentDestinationId,
  bankAccountOptions,
  onNameChange,
  onBranchNameChange,
  onAccountNumberChange,
  onIssuerChange,
  onLast4Change,
  onClosingDayChange,
  onPaymentDayChange,
  onPaymentDestinationIdChange,
  statusClassName,
}: AccountCreatePanelProps) {
  if (!isOpen) return null
  const config = TITLES[assetKind]
  const isBank = assetKind === 'bank_account'
  const isCard = assetKind === 'credit_card'

  return (
    <ModalBackdrop
      onClose={onToggle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
    >
      <div className="w-full max-w-2xl rounded-[18px] border border-[#d7dee4] bg-white p-6 shadow-[0_20px_60px_rgba(16,38,49,0.25)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-[#0d2b32]">{config.title}</p>
            <p className="text-xs text-[#7a8790]">{config.description}</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className={buttonClasses({
              variant: 'ghost',
              size: 'sm',
              shape: 'rounded',
              className: 'text-xs font-bold',
            })}
          >
            閉じる
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
            <span>{config.nameLabel}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={config.placeholder}
              className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
            />
          </label>

          {isBank && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                <span>支店名 (任意)</span>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => onBranchNameChange(e.target.value)}
                  placeholder="例: 渋谷支店"
                  className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                <span>口座番号 (任意)</span>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => onAccountNumberChange(e.target.value)}
                  placeholder="例: 0000000"
                  className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                />
              </label>
            </div>
          )}

          {isCard && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>発行会社 (任意)</span>
                  <input
                    type="text"
                    value={issuer}
                    onChange={(e) => onIssuerChange(e.target.value)}
                    placeholder="例: 架空カード株式会社"
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>カード番号下4桁 (任意)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={last4}
                    onChange={(e) => onLast4Change(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="例: 0000"
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>締め日 (1-31, 任意)</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={closingDay}
                    onChange={(e) => onClosingDayChange(e.target.value)}
                    placeholder="例: 15"
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                  <span>引落日 (1-31, 任意)</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={paymentDay}
                    onChange={(e) => onPaymentDayChange(e.target.value)}
                    placeholder="例: 27"
                    className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0f1c22]">
                <span>引落先銀行口座 (任意)</span>
                <select
                  value={paymentDestinationId}
                  onChange={(e) => onPaymentDestinationIdChange(e.target.value)}
                  className="w-full rounded-xl border border-[#d7dee4] bg-[#f7f9fb] px-3.5 py-2.5 text-[#0f1c22]"
                >
                  <option value="">未設定</option>
                  {bankAccountOptions.map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.accountName}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={status === 'loading'}
              className={buttonClasses({
                variant: 'primary',
                size: 'lg',
                shape: 'rounded',
                className: 'px-5 py-3 font-bold',
              })}
            >
              {status === 'loading' ? '作成中...' : config.submit}
            </button>
          </div>
        </form>

        {message && status !== 'idle' && (
          <div
            className={`mt-4 rounded-[10px] px-4 py-3 text-sm backdrop-blur-sm ${statusClassName(
              status === 'loading' ? 'loading' : status === 'success' ? 'success' : 'error'
            )}`}
          >
            <p>{message}</p>
          </div>
        )}
      </div>
    </ModalBackdrop>
  )
}

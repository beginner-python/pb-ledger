export type UploadResult = {
  created?: number
  error?: string
}

export type BalanceResult = {
  totalAssets?: string | number
  totalAssetsChange?: string | number
  bankAccountsTotal?: string | number
  bankAccountsTotalChange?: string | number
  creditCardsTotal?: string | number
  creditCardsTotalChange?: string | number
  cashWalletsTotal?: string | number
  cashWalletsTotalChange?: string | number
  financialAssetsTotal?: string | number
  financialAssetsTotalChange?: string | number
  previousMonthEnd?: string
  bankAccounts?: AssetAccount[]
  creditCards?: AssetAccount[]
  cashWallets?: AssetAccount[]
  financialAssets?: AssetAccount[]
  error?: string
}

export type SnapshotResult = {
  created?: number
  error?: string
}

export type AssetSnapshot = {
  id: number
  assetKind: AssetKind
  accountId: number
  asOf: string
  balance: string | number
  notes: string
}

export type SnapshotListResult = {
  snapshots?: AssetSnapshot[]
  error?: string
}

export type SnapshotMutationResult = {
  updated?: number
  deleted?: number
  error?: string
}

export type CreateAccountResult = {
  error?: string
}

export type DeleteAccountResult = {
  deleted?: number
  deletedTransactions?: number
  deletedSnapshots?: number
  error?: string
}

export type MonthlySummaryAccount = {
  accountId: number
  income: string
  expense: string
}

export type MonthlySummaryResult = {
  totalIncome?: string
  totalExpense?: string
  accounts?: MonthlySummaryAccount[]
  error?: string
}

export type AccountsResult = {
  accounts?: AssetAccount[]
  error?: string
}

export type AssetKind =
  | 'bank_account'
  | 'credit_card'
  | 'cash'
  | 'financial_asset'

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  bank_account: '銀行口座',
  credit_card: 'クレジットカード',
  cash: '現金',
  financial_asset: '金融資産',
}

export type AssetAccount = {
  assetKind: AssetKind
  accountId: number
  accountName: string
  balance: string | number | null
  previousBalance?: string | number | null
  balanceChange?: string | number | null
  lastUpdated: string | null
  source: string
  hasCsvTemplate?: boolean
  referenceUrl?: string
}

export type AccountTransaction = {
  id: number
  date: string
  description: string
  amount: string | number | null
  balance: string | number | null
  notes: string
  linkedExpenseAmount?: string | number | null
  linkedExpenseCount?: number
  linkedTransferId?: number | null
  linkedTransferAmount?: string | null
  linkedTransferDirection?: 'in' | 'out' | null
  linkedTransferOtherAccountId?: number | null
  linkedTransferOtherAccountName?: string | null
  linkedTransferDate?: string | null
  linkedTransferNotes?: string | null
  linkedTransferOppositeFree?: boolean
}

export type SelectedAccount = {
  id: string
  assetKind: AssetKind
}

export type TabKey = 'household' | 'balance'

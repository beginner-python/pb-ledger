export type Transfer = {
  id: number
  date: string
  amount: string
  fromAccountId: number
  toAccountId: number
  fromTransactionId: number | null
  toTransactionId: number | null
  notes: string
}

export type TransferFormInput = {
  date: string
  amount: string
  fromAccountId: string
  toAccountId: string
  notes: string
}

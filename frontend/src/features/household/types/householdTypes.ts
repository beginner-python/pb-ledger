export type HouseholdSummaryItem = {
  categoryId: number
  categoryName: string
  categoryColor: string | null
  parentCategoryId: number | null
  total: string | null
}

export type HouseholdSummary = {
  year: number
  month: number
  total: string | null
  items: HouseholdSummaryItem[]
}

export type BudgetSummaryItem = {
  allocationId: number | null
  categoryId: number
  categoryName: string
  categoryColor: string | null
  parentCategoryId: number | null
  isParent?: boolean
  budget: string | null
  spent: string | null
  ownSpent?: string | null
  childrenSpent?: string | null
  childrenWithBudgetSpent?: string | null
  childrenWithoutBudgetSpent?: string | null
  remaining: string | null
  usageRate: string | null
  notes?: string | null
}

export type BudgetDisplayItem = Omit<
  BudgetSummaryItem,
  | 'budget'
  | 'spent'
  | 'remaining'
  | 'ownSpent'
  | 'childrenSpent'
  | 'childrenWithBudgetSpent'
  | 'childrenWithoutBudgetSpent'
  | 'usageRate'
> & {
  budget: number
  spent: number
  ownSpent: number
  childrenSpent: number
  childrenWithBudgetSpent: number
  childrenWithoutBudgetSpent: number
  remaining: number
  usageRate: number
  overAmount: number
  exceeded: boolean
  atLimit: boolean
  warning: boolean
  tone: {
    border: string
    bg: string
    text: string
    track: string
    bar: string
    badge: string
    label: string
  }
  color: string
}

export type BudgetSummary = {
  year: number
  month: number
  periodId: number | null
  periodTotalAmount: string | null
  periodTotalSpent: string | null
  totalBudget: string | null
  totalSpent: string | null
  items: BudgetSummaryItem[]
}

export type HouseholdCategoryOption = {
  id: number
  name: string
  color: string | null
  notes?: string | null
  parentId: number | null
  hasChildren?: boolean
}

export type CreateExpenseInput = {
  amount: string
  category: string
  date: string
  notes: string
  paymentAccountId?: string
}

export type PaymentAccountKind = 'bank_account' | 'credit_card' | 'cash'

export type PaymentAccountOption = {
  id: number
  name: string
  type: string
  kind: PaymentAccountKind
}

export type CreateExpenseVars = {
  input: CreateExpenseInput
  keepOpen: boolean
}

export type CreateBudgetInput = {
  year: number
  month: number
  category: string
  amount: string
  notes: string
}

export type CreateBudgetVars = {
  input: CreateBudgetInput
  keepOpen: boolean
}

export type UpdateBudgetInput = {
  allocationId: number
  category: string
  amount: string
  notes: string
}

export type CreateCategoryInput = {
  name: string,
  color: string,
  parentId: number | null,
  notes: string,
}

export type UpdateCategoryInput = {
  id: number,
  name: string,
  color: string,
  parentId: number | null,
  notes: string,
}

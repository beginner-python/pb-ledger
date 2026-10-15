import { useMemo } from 'react'
import type { HouseholdCategoryOption } from '../types/householdTypes'

type CategoryTreeSelectProps = {
  id?: string
  className?: string
  categories: HouseholdCategoryOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  placeholderValue?: string
  disabled?: boolean
  required?: boolean
}

type TreeRow = {
  id: number
  label: string
  isChild: boolean
}

// 親→子の階層を 1 段インデント付きの選択肢列に並べ替える。
// optgroup を使わないのは「親自身も選択可能」を維持するため。
function buildRows(categories: HouseholdCategoryOption[]): TreeRow[] {
  const parents = categories
    .filter((c) => c.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const childrenByParent = new Map<number, HouseholdCategoryOption[]>()
  for (const category of categories) {
    if (category.parentId !== null) {
      const list = childrenByParent.get(category.parentId) ?? []
      list.push(category)
      childrenByParent.set(category.parentId, list)
    }
  }
  const rows: TreeRow[] = []
  for (const parent of parents) {
    rows.push({ id: parent.id, label: parent.name, isChild: false })
    const children = (childrenByParent.get(parent.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const child of children) {
      rows.push({ id: child.id, label: child.name, isChild: true })
    }
  }
  // 親が見つからない (データ整合が崩れた) 子は末尾にフラットで残す。
  const orphanIds = new Set(rows.map((r) => r.id))
  for (const category of categories) {
    if (!orphanIds.has(category.id)) {
      rows.push({ id: category.id, label: category.name, isChild: false })
    }
  }
  return rows
}

export default function CategoryTreeSelect({
  id,
  className,
  categories,
  value,
  onChange,
  placeholder = 'カテゴリを選択',
  placeholderValue = '',
  disabled,
  required,
}: CategoryTreeSelectProps) {
  const rows = useMemo(() => buildRows(categories), [categories])
  const baseClass =
    'w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea] disabled:cursor-not-allowed disabled:bg-[#f2f4f6]'

  return (
    <select
      id={id}
      className={className ?? baseClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={required}
    >
      <option value={placeholderValue}>{placeholder}</option>
      {rows.map((row) => (
        <option key={row.id} value={row.id}>
          {row.isChild ? `\u3000\u3000└ ${row.label}` : row.label}
        </option>
      ))}
    </select>
  )
}

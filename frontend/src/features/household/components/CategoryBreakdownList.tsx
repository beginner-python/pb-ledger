import { useMemo, useState } from 'react'
import type {
  HouseholdCategoryOption,
  HouseholdSummaryItem,
} from '../types/householdTypes'
import { resolveCategoryColor } from '../utils/categoryColors'

type Props = {
  items: HouseholdSummaryItem[]
  categories: HouseholdCategoryOption[]
  formatYen: (value: number | string | null | undefined) => string
}

type SummaryGroup = {
  key: string
  parentId: number | null
  name: string
  color: string | null
  total: number
  selfTotal: number
  children: HouseholdSummaryItem[]
}

function toAmount(value: string | null): number {
  if (value === null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default function CategoryBreakdownList({ items, categories, formatYen }: Props) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const groups = useMemo<SummaryGroup[]>(() => {
    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const groupMap = new Map<string, SummaryGroup>()

    for (const item of items) {
      const parentMeta =
        item.parentCategoryId !== null
          ? categoryById.get(item.parentCategoryId) ?? null
          : null

      if (parentMeta) {
        const key = `p:${parentMeta.id}`
        const existing = groupMap.get(key)
        const amount = toAmount(item.total)
        if (existing) {
          existing.total += amount
          existing.children.push(item)
        } else {
          groupMap.set(key, {
            key,
            parentId: parentMeta.id,
            name: parentMeta.name,
            color: parentMeta.color ?? null,
            total: amount,
            selfTotal: 0,
            children: [item],
          })
        }
        continue
      }

      const key = `p:${item.categoryId}`
      const amount = toAmount(item.total)
      const existing = groupMap.get(key)
      if (existing) {
        existing.total += amount
        existing.selfTotal += amount
      } else {
        groupMap.set(key, {
          key,
          parentId: item.categoryId,
          name: item.categoryName,
          color: item.categoryColor,
          total: amount,
          selfTotal: amount,
          children: [],
        })
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.total - a.total)
  }, [items, categories])

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const expanded = expandedKeys.has(group.key)
        const hasChildren = group.children.length > 0
        return (
          <div key={group.key} className="flex flex-col gap-1">
            <button
              type="button"
              className="flex items-center justify-between gap-3 rounded-lg px-1 py-1 text-left hover:bg-[#f1f5f7]"
              onClick={() => hasChildren && toggle(group.key)}
              disabled={!hasChildren}
            >
              <div className="flex items-center gap-2">
                {hasChildren && (
                  <span className="text-[10px] text-[#5d6a72]">
                    {expanded ? '▾' : '▸'}
                  </span>
                )}
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: resolveCategoryColor(group.name, group.color),
                  }}
                ></span>
                <span className="text-sm font-medium text-[#0f1c22]">{group.name}</span>
                {hasChildren && (
                  <span className="rounded-full bg-[#e7f0ed] px-1.5 py-0.5 text-[10px] font-semibold text-[#0d2b32]">
                    {group.children.length}
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold text-[#0f1c22]">
                {formatYen(group.total)}
              </span>
            </button>
            {expanded && hasChildren && (
              <div className="flex flex-col gap-1 pl-6">
                {group.selfTotal > 0 && (
                  <div className="flex items-center justify-between text-[0.75rem] text-[#5d6a72]">
                    <span>その他 (親直下)</span>
                    <span>{formatYen(group.selfTotal)}</span>
                  </div>
                )}
                {group.children.map((child) => (
                  <div
                    key={child.categoryId}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: resolveCategoryColor(
                            child.categoryName,
                            child.categoryColor
                          ),
                        }}
                      ></span>
                      <span className="text-[0.8rem] text-[#0f1c22]">
                        {child.categoryName}
                      </span>
                    </div>
                    <span className="text-[0.8rem] font-semibold text-[#0f1c22]">
                      {formatYen(child.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

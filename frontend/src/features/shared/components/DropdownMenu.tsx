import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type DropdownMenuItem = {
  key: string
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
  title?: string
  tone?: 'default' | 'danger'
}

type DropdownMenuProps = {
  trigger: (props: { open: boolean; toggle: () => void; menuId: string }) => ReactNode
  items: DropdownMenuItem[]
  align?: 'left' | 'right'
  className?: string
}

export default function DropdownMenu({
  trigger,
  items,
  align = 'right',
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent) => {
      const node = wrapRef.current
      if (!node) return
      if (node.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const visibleItems = items.filter(Boolean)

  return (
    <div ref={wrapRef} className={`relative inline-flex ${className ?? ''}`}>
      {trigger({ open, toggle: () => setOpen((v) => !v), menuId })}
      {open && visibleItems.length > 0 && (
        <div
          id={menuId}
          role="menu"
          className={`absolute top-full z-40 mt-1 min-w-[180px] overflow-hidden rounded-2xl border border-[#d7dee4] bg-white py-1 shadow-[0_18px_42px_rgba(16,38,49,0.18)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {visibleItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (item.disabled) return
                setOpen(false)
                item.onSelect()
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                item.tone === 'danger'
                  ? 'text-[#b91c1c] hover:bg-[#fff1f2]'
                  : 'text-[#0f1c22] hover:bg-[#eff6f7]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

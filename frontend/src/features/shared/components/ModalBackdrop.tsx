import type { ReactNode } from 'react'

import ModalPortal from './ModalPortal'

type ModalBackdropProps = {
  onClose: () => void
  children: ReactNode
  className?: string
}

const defaultClassName =
  'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'

// 背景をマウスダウン (mouseup ではなく) で閉じる。
// ハンバーガーメニューの挙動 (document mousedown で外側判定) に揃える。
// 内側パネル上での mousedown は event.target !== event.currentTarget なので閉じない。
export default function ModalBackdrop({
  onClose,
  children,
  className = defaultClassName,
}: ModalBackdropProps) {
  return (
    <ModalPortal>
      <div
        className={className}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        {children}
      </div>
    </ModalPortal>
  )
}

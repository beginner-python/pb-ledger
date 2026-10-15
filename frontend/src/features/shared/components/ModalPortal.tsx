import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

type ModalPortalProps = {
  children: ReactNode
}

// 親要素に backdrop-filter / transform / filter / will-change 等があると
// position: fixed の包含ブロックがビューポートから親要素にずれる。
// document.body 直下に描画することで、常にビューポート基準で fixed を効かせる。
export default function ModalPortal({ children }: ModalPortalProps) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

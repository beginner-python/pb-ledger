import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { anonymousFetcher, logout } from '../../api/client'
import { buttonClasses, tabButtonClasses } from '../../ui/button'

type MenuPosition = { top: number; right: number }

export default function TopLayout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()

  const handleLogout = async () => {
    setIsMenuOpen(false)
    try {
      await anonymousFetcher('/api/auth/logout/', { method: 'POST' })
    } finally {
      logout()
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }

  const toggleMenu = () => {
    setIsMenuOpen((prev) => {
      const next = !prev
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setMenuPosition({
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        })
      }
      return next
    })
  }

  useEffect(() => {
    if (!isMenuOpen) return

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    // Portal で body 直下に描画するため、スクロール/リサイズで
    // トリガーボタンと位置がズレる。閉じることでズレを回避する。
    const handleViewportChange = () => setIsMenuOpen(false)

    document.addEventListener('mousedown', handleDocumentClick)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [isMenuOpen])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_18%_20%,#f5f2e9_0%,#eef4f7_55%,#e9f0f7_100%)] text-[#0f1c22]">
      <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-6 px-9 py-9 font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic',sans-serif]">
        <header className="flex w-full max-w-[960px] flex-col gap-3 self-center">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Link
                to="/household"
                className="text-[1.65rem] font-semibold tracking-[-0.02em] text-[#0d2b32]"
              >
                PB Ledger
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <button
                ref={triggerRef}
                type="button"
                className={buttonClasses({ variant: 'icon', size: 'icon', shape: 'pill' })}
                aria-expanded={isMenuOpen}
                aria-label="メニュー"
                onClick={toggleMenu}
              >
                <span className="flex flex-col gap-1">
                  <span className="h-0.5 w-6 bg-[#0f1c22]"></span>
                  <span className="h-0.5 w-6 bg-[#0f1c22]"></span>
                  <span className="h-0.5 w-6 bg-[#0f1c22]"></span>
                </span>
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <NavLink
              to="/household"
              className={({ isActive }) => tabButtonClasses(isActive)}
            >
              家計簿
            </NavLink>
            <NavLink
              to="/balance"
              className={({ isActive }) => tabButtonClasses(isActive)}
            >
              資産管理
            </NavLink>
            <NavLink
              to="/cards"
              className={({ isActive }) => tabButtonClasses(isActive)}
            >
              カード
            </NavLink>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
          <Outlet />
        </div>
      </div>
      {isMenuOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: menuPosition.top, right: menuPosition.right }}
            className="fixed z-[1000] w-44 rounded-2xl border border-[#d7dee4] bg-white p-3 shadow-[0_15px_40px_rgba(15,28,34,0.25)]"
          >
            <button
              type="button"
              className={buttonClasses({
                variant: 'ghost',
                size: 'md',
                shape: 'rounded',
                className: 'w-full text-left text-sm font-medium',
              })}
              onClick={() => {
                setIsMenuOpen(false)
                navigate('/household/categories')
              }}
            >
              カテゴリ編集
            </button>
            <button
              type="button"
              className={buttonClasses({
                variant: 'ghost',
                size: 'md',
                shape: 'rounded',
                className: 'mt-2 w-full text-left text-sm font-medium',
              })}
              onClick={handleLogout}
            >
              ログアウト
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}

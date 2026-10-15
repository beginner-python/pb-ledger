import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// authFetcher は相対パスで fetch する。Node の fetch は相対 URL を扱えないので、
// jsdom の origin を API のベース URL にして MSW (相対パスのハンドラ) に流す。
vi.stubEnv('VITE_API_BASE_URL', window.location.origin)

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

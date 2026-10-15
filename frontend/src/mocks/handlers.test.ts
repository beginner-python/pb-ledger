import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { fixtureKey, handlers } from './handlers'

const server = setupServer(...handlers)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const api = (path: string, init?: RequestInit) => fetch(`${window.location.origin}${path}`, init)

describe('fixtureKey', () => {
  it('クエリの順序に関係なく同じキーになる', () => {
    const a = fixtureKey('GET', new URL('http://x/api/household/expenses/?year=2026&month=10'))
    const b = fixtureKey('GET', new URL('http://x/api/household/expenses/?month=10&year=2026'))
    expect(a).toBe(b)
    expect(a).toBe('GET /api/household/expenses/?month=10&year=2026')
  })
})

describe('デモの認証', () => {
  it('ログイン前のリフレッシュは 401、ログイン後は 200 になる', async () => {
    expect((await api('/api/auth/refresh/', { method: 'POST' })).status).toBe(401)
    const login = await api('/api/auth/login/', { method: 'POST', body: '{}' })
    expect(login.status).toBe(200)
    expect(await login.json()).toEqual({ access: expect.any(String) })
    expect((await api('/api/auth/refresh/', { method: 'POST' })).status).toBe(200)
    expect((await api('/api/auth/logout/', { method: 'POST' })).status).toBe(204)
    expect((await api('/api/auth/refresh/', { method: 'POST' })).status).toBe(401)
  })
})

describe('記録済み応答', () => {
  it('記録されている GET は本文をそのまま返す', async () => {
    const res = await api('/api/household/categories/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ name: string }>
    expect(body.map((c) => c.name)).toContain('食費')
  })

  it('記録されていない GET は 404 を返す', async () => {
    const res = await api('/api/ledger/assets/?month=1999-01')
    expect(res.status).toBe(404)
  })

  it('変更操作はすべて拒否し、error と detail の両方に理由を入れる', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const res = await api('/api/household/categories/', { method })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe(body.detail)
      expect(body.error).toMatch(/デモ/)
    }
  })
})

/**
 * 公開デモ用の MSW ハンドラ。
 *
 * - GET は `record_demo_fixtures` が記録した JSON をそのまま返す。
 * - 認証はブラウザ内の sessionStorage で擬似的に保持する。外部へは一切通信しない。
 * - 書き込み系はデモでは受け付けず、理由をエラーとして返す。
 */
import { HttpResponse, http, type JsonBodyType } from 'msw'
import recorded from './fixtures/recorded.json'

type Recorded = {
  anchorMonth: string
  demoEmail: string
  responses: Record<string, { status: number; body: JsonBodyType }>
}

const fixtures = recorded as Recorded
const AUTH_FLAG = 'pb-ledger-demo-auth'
const DEMO_ACCESS_TOKEN = 'demo-access-token'
const DEMO_READ_ONLY_MESSAGE = 'デモでは変更操作を受け付けていません。'

function isAuthenticated() {
  try {
    return sessionStorage.getItem(AUTH_FLAG) === '1'
  } catch {
    return false
  }
}

function setAuthenticated(value: boolean) {
  try {
    if (value) sessionStorage.setItem(AUTH_FLAG, '1')
    else sessionStorage.removeItem(AUTH_FLAG)
  } catch {
    // sessionStorage が使えない環境では毎回ログインし直す
  }
}

/** 記録時と同じ正規化: パス + ソート済みクエリ */
export function fixtureKey(method: string, url: URL) {
  const params = new URLSearchParams(url.search)
  params.sort()
  const query = params.toString()
  return `${method.toUpperCase()} ${url.pathname}${query ? `?${query}` : ''}`
}

export const handlers = [
  http.post('/api/auth/login/', () => {
    setAuthenticated(true)
    return HttpResponse.json({ access: DEMO_ACCESS_TOKEN })
  }),
  http.post('/api/auth/refresh/', () => {
    if (!isAuthenticated()) {
      return HttpResponse.json({ detail: 'unauthorized' }, { status: 401 })
    }
    return HttpResponse.json({ access: DEMO_ACCESS_TOKEN })
  }),
  http.post('/api/auth/logout/', () => {
    setAuthenticated(false)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('/api/*', ({ request }) => {
    const key = fixtureKey('GET', new URL(request.url))
    const hit = fixtures.responses[key]
    if (!hit) {
      return HttpResponse.json(
        { error: `デモには記録されていない要求です: ${key}` },
        { status: 404 }
      )
    }
    return HttpResponse.json(hit.body, { status: hit.status })
  }),

  // 画面によって error / detail のどちらを読むかが異なるため両方に同じ文言を入れる
  http.all('/api/*', () =>
    HttpResponse.json(
      { error: DEMO_READ_ONLY_MESSAGE, detail: DEMO_READ_ONLY_MESSAGE },
      { status: 403 }
    )
  ),
]

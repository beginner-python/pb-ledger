import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
// `--mode demo` は公開デモ (GitHub Pages) 用。
// - サブパス配信のため base をリポジトリ名に合わせる
// - MSW の service worker は demo ビルドにだけ同梱する
export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo'
  return {
    plugins: [tailwindcss(), react()],
    base: isDemo ? '/pb-ledger/' : '/',
    publicDir: isDemo ? 'public-demo' : 'public',
    server: isDemo ? undefined : { proxy: { '/api': 'http://backend:8000' } },
  }
})

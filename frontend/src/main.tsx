import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { bootstrapAuth } from "./api/client"
import "./index.css"


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message === "unauthorized") return false;
        return failureCount < 3;
      },
    }
  }
})

async function prepare() {
  // 公開デモではバックエンドが無いので、API を MSW で差し替えてから起動する。
  // 通常ビルドではこの分岐ごと取り除かれ、mocks/ はバンドルに含まれない。
  if (import.meta.env.MODE === "demo") {
    const { startDemoWorker } = await import("./mocks/browser")
    await startDemoWorker()
  }
  // アプリ起動時に refresh cookie から access を復元する。
  // この初期化が終わるまでは route guard が isHydrating を見て判定を待機する。
  void bootstrapAuth()
}

void prepare().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </StrictMode>,
  )
})

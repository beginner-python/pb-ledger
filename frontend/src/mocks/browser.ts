import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

export async function startDemoWorker() {
  await worker.start({
    // GitHub Pages のサブパス配信に合わせて worker の場所を解決する
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })
}

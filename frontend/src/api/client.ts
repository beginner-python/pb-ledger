import { useAuthStore } from "../authStore";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

let refreshPromise: Promise<string> | null = null;
let bootstrapPromise: Promise<void> | null = null;

export function getAccessToken() {
  return useAuthStore.getState().accessToken;
}

export function setAccessToken(token: string) {
  useAuthStore.getState().setAccessToken(token);
}

export function clearAccessToken() {
  useAuthStore.getState().clearAccessToken();
}

function setHydrating(value: boolean) {
  // 認証の初期化中フラグを更新する。
  // true の間は route guard 側で遷移判定を保留し、誤リダイレクトを防ぐ。
  useAuthStore.getState().setHydrating(value);
}

export function apiFetcher(input: string, init?: RequestInit) {
  const url = input.startsWith("http") ? input : `${API_BASE}${input}`;
  // 同一オリジンでは Cookie(=HttpOnly refresh) を送受信できるようにする。
  // これがないと refresh/logout で cookie が付かず認証が復元できない。
  return fetch(url, { credentials: "same-origin", ...init });
}

export function anonymousFetcher(input: string, init?: RequestInit) {
  return apiFetcher(input, init);
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const res = await apiFetcher("/api/auth/refresh/", {
      method: "POST",
    });

    if (!res.ok) {
      logout();
      throw new Error("unauthorized");
    }

    const data = await res.json();
    if (!data?.access) {
      logout();
      throw new Error("unauthorized");
    }

    setAccessToken(data.access);
    return data.access as string;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function authFetcher(input: string, init?: RequestInit) {
  let token = getAccessToken();
  if (!token) {
    token = await refreshAccessToken();
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await apiFetcher(input, { ...init, headers });

  if (res.status !== 401) return res;

  const refreshedToken = await refreshAccessToken();
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
  const retryRes = await apiFetcher(input, { ...init, headers: retryHeaders });

  if (retryRes.status === 401) {
    logout();
    throw new Error("unauthorized");
  }
  return retryRes;
}

export async function bootstrapAuth() {
  // アプリ起動時に「refresh cookie から access を復元」するための初期化関数。
  // これにより、リロード後もログイン状態を再構築できる。
  // ここがロック判定:
  // すでに初期化中(bootstrapPromise が入っている)なら、新規実行せず同じ Promise を返して待つ。
  if (bootstrapPromise) return bootstrapPromise;

  // 同時に複数箇所から呼ばれても初期化処理を1回にまとめるため、
  // 進行中の Promise を共有する。
  // ここがロック取得:
  // 最初の呼び出しだけが bootstrapPromise をセットして実処理を開始する。
  bootstrapPromise = (async () => {
    // 起動時の refresh 判定が終わるまで guard 判定を待機させる。
    setHydrating(true);
    try {
      await refreshAccessToken();
    } catch (error) {
      // 未ログイン (refresh cookie なし) は正常系。ログイン画面へ誘導されるだけなので握りつぶす。
      if (!(error instanceof Error && error.message === "unauthorized")) throw error;
    } finally {
      // 判定完了。guard が通常の遷移判定を再開できる状態に戻す。
      setHydrating(false);
    }
  })();

  try {
    await bootstrapPromise;
  } finally {
    // ここがロック解放:
    // 初期化完了後に null に戻し、次回の bootstrapAuth を実行可能にする。
    bootstrapPromise = null;
  }
}

export function logout() {
  refreshPromise = null;
  clearAccessToken();
}

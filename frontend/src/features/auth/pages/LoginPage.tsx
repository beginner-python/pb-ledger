import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { anonymousFetcher, setAccessToken } from "../../../api/client";
import { buttonClasses } from "../../../ui/button";
import { useMutation } from "@tanstack/react-query";

type LoginResponse = {
  access: string;
  user?: {
    id: number;
    email: string;
  };
};

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "通信に失敗しました。ネットワーク状況を確認してください。";
  }

  if (error && typeof error === "object" && "message" in error) {
    // バックエンドから受け取ったエラー内容を表示するように変更
    // const msg = String((error as any).message);
    // return msg || "ログインに失敗しました。";
    return "ログインに失敗しました。メールアドレスとパスワードを確認してください。";
  }
  return "ログインに失敗しました。メールアドレスとパスワードを確認してください。";
}

async function login(input: { email: string; password: string }): Promise<LoginResponse> {
  const res = await anonymousFetcher("/api/auth/login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  // エラー時の処理強化
  // エラーJSONの取得
  // ステータスに応じたメッセージの表示
  if (!res.ok) {
    throw new Error("failed to login");
  }

  return (await res.json()) as LoginResponse;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationKey: ["login"],
    mutationFn: login,
    onSuccess: (data) => {
      // onSuccess では状態更新と画面遷移だけを行う。
      setAccessToken(data.access);
      navigate("/household");
    },
  });

  const errorMessage = loginMutation.isError ? getLoginErrorMessage(loginMutation.error) : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loginMutation.mutate({ email, password });
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-slate-900">
      <section className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.08)]">
        <div>
          <h1 className="text-2xl font-bold">ログイン</h1>
        </div>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-slate-500">Email</span>
            <input
              id="email"
              type="email"
              name="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[15px] text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-600/20"
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-slate-500">Password</span>
            <input
              id="password"
              type="password"
              name="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[15px] text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-600/20"
              required
            />
          </label>

          {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}

          <button
            type="submit"
            className={buttonClasses({
              variant: "primary",
              size: "lg",
              shape: "rounded",
              className: "mt-1 w-full text-[15px] font-bold",
            })}
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "送信中..." : "ログイン"}
          </button>
        </form>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 max-sm:flex-col max-sm:items-start">
          <a className="font-semibold text-blue-600 hover:underline" href="#">
            パスワードをお忘れですか？
          </a>
          <a className="font-semibold text-blue-600 hover:underline" href="#">
            新規登録する
          </a>
        </div>
      </section>
    </main>
  );
}

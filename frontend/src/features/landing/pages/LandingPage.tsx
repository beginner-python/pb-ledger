import { Link, useNavigate } from "react-router-dom";
import { anonymousFetcher, setAccessToken } from "../../../api/client";
import { buttonClasses } from "../../../ui/button";

// 公開デモ (vite --mode demo) では文言を切り替え、ログイン画面を経由せずに入る
const isDemo = import.meta.env.MODE === "demo";

const ctaClassName = buttonClasses({
  variant: "primary",
  size: "md",
  shape: "pill",
  className: "text-sm font-bold",
});

export default function LandingPage() {
  const navigate = useNavigate();

  const openDemo = async () => {
    // モック API がログイン済み状態を記録するので、資格情報は何でもよい
    const res = await anonymousFetcher("/api/auth/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@example.com", password: "demo" }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access) {
      navigate("/login");
      return;
    }
    setAccessToken(data.access);
    navigate("/household");
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_15%_12%,#f5efe1_0%,#f0f2f6_45%,#e8edf2_100%)] text-[#0f1f24]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,#d7efe7_0%,rgba(215,239,231,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,#cfd8f3_0%,rgba(207,216,243,0)_70%)] blur-3xl" />
      <div className="relative mx-auto flex w-full max-w-[1120px] flex-col gap-14 px-6 py-10 font-['Hiragino_Kaku_Gothic_ProN','Yu_Gothic','Noto_Sans_JP',sans-serif]">
        <header className="flex flex-col gap-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-[0.45em] text-[#37646a]">
                PB LEDGER
              </span>
              <span className="text-sm text-[#1b3a3f]">家計と資産の帳簿</span>
            </div>
            {isDemo ? (
              <button type="button" className={ctaClassName} onClick={() => void openDemo()}>
                デモを開く
              </button>
            ) : (
              <Link className={ctaClassName} to="/login">
                ログイン
              </Link>
            )}
          </div>

          <div className="grid items-start gap-8 md:grid-cols-[1fr_1fr]">
            <div className="flex flex-col gap-6">
              <p className="max-w-xl text-lg leading-9 text-[#0f1f24]">
                PB Ledger は個人向けの家計アプリです。月ごとの予算と支出、
                口座や現金の残高、カードの利用額を記録します。
              </p>
              {isDemo && (
                <p className="max-w-xl text-sm leading-7 text-[#5d6a72]">
                  このデモは架空のデータで動きます。入力しても保存されません。
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-sm font-semibold text-[#145e52]">
                <span className="rounded-full border border-[#cfe1dd] bg-[#eef6f4] px-4 py-2">
                  家計簿
                </span>
                <span className="rounded-full border border-[#cfe1dd] bg-[#eef6f4] px-4 py-2">
                  資産管理
                </span>
                <span className="rounded-full border border-[#cfe1dd] bg-[#eef6f4] px-4 py-2">
                  カード
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-[18px] border border-[#d7dee4] bg-[radial-gradient(circle_at_20%_20%,rgba(30,122,108,0.03),transparent_35%),#ffffff] p-4 shadow-[0_18px_42px_rgba(16,38,49,0.16)]">
              <div className="grid items-end gap-2 md:grid-cols-[1fr_auto]">
                <div>
                  <h3 className="text-base font-semibold text-[#0d2b32]">家計簿</h3>
                  <p className="text-[0.7rem] text-[#5d6a72]">月別の支出割合</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.6rem] font-semibold text-[#0f1c22]">
                    先月
                  </span>
                  <span className="min-w-[96px] rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-center text-[0.65rem] font-semibold text-[#0d2b32]">
                    2026年5月
                  </span>
                  <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.6rem] font-semibold text-[#0f1c22]">
                    翌月
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e0e6eb] bg-white p-3 shadow-[0_8px_18px_rgba(16,38,49,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-[#0d2b32]">今月の合計支出</h4>
                    <p className="mt-0.5 text-[0.6rem] text-[#5d6a72]">2026年5月</p>
                  </div>
                  <p className="text-xl font-bold text-[#0d2b32]">¥123,400</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e0e6eb] bg-white p-3 shadow-[0_8px_18px_rgba(16,38,49,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-2 pb-2">
                  <div>
                    <h4 className="text-xs font-semibold text-[#0d2b32]">予算の使用状況</h4>
                    <span className="mt-1.5 inline-flex rounded-full border border-[#1a7b6d] bg-[linear-gradient(135deg,#1b7a6c,#2a9280)] px-2 py-0.5 text-[0.55rem] font-semibold text-[#f6fffb] shadow-[0_4px_10px_rgba(31,146,127,0.28)]">
                      ＋予算
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[0.55rem] font-semibold text-[#0d2b32]">
                    <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-2 py-0.5">
                      使用済み: ¥123,400
                    </span>
                    <span className="rounded-full border border-[#d7dee4] bg-[#f7f9fb] px-2 py-0.5">
                      残り使用可能: ¥56,600
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#e6ebef] bg-[#fbfbfc] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-[#d7dee4] bg-white px-1.5 py-0.5 text-[0.55rem] font-semibold text-[#0f1c22]">
                      予算合計
                    </span>
                    <span className="text-[0.6rem] font-semibold text-[#0d2b32]">
                      使用率: 68.5%
                      <span className="ml-1 rounded-full border border-[#d7dee4] bg-white px-1.5 py-0.5 text-[0.5rem]">
                        通常
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#e9edf1]">
                    <div className="h-full w-[68%] rounded-full bg-[#1f927f]" />
                  </div>
                  <div className="mt-1.5 flex flex-wrap justify-between gap-1 text-[0.55rem] font-semibold text-[#5d6a72]">
                    <span>予算: ¥180,000</span>
                    <span>使用済み: ¥123,400</span>
                    <span className="text-[#0f1c22]">残り使用可能: ¥56,600</span>
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  {[
                    {
                      name: '食費',
                      color: '#1f927f',
                      budget: '¥60,000',
                      spent: '¥45,000',
                      remaining: '¥15,000',
                      usage: 75,
                      rate: '75.0%',
                    },
                    {
                      name: '日用品',
                      color: '#C36BB3',
                      budget: '¥30,000',
                      spent: '¥18,000',
                      remaining: '¥12,000',
                      usage: 60,
                      rate: '60.0%',
                    },
                  ].map((item) => (
                    <div
                      key={item.name}
                      className="rounded-2xl border border-[#e6ebef] bg-[#fbfbfc] px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-[0.7rem] font-semibold text-[#0f1c22]">
                            {item.name}
                          </span>
                          <span className="rounded-full border border-[#d7dee4] bg-white px-1.5 py-0.5 text-[0.5rem] font-semibold text-[#0f1c22]">
                            編集
                          </span>
                          <span className="rounded-full border border-[#f2b4b4] bg-[#fff1f2] px-1.5 py-0.5 text-[0.5rem] font-semibold text-[#b91c1c]">
                            削除
                          </span>
                        </div>
                        <span className="text-[0.6rem] font-semibold text-[#0d2b32]">
                          使用率: {item.rate}
                          <span className="ml-1 rounded-full border border-[#d7dee4] bg-white px-1.5 py-0.5 text-[0.5rem]">
                            通常
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#e9edf1]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${item.usage}%`, backgroundColor: item.color }}
                        />
                      </div>
                      <div className="mt-1.5 flex flex-wrap justify-between gap-1 text-[0.55rem] font-semibold text-[#5d6a72]">
                        <span>予算: {item.budget}</span>
                        <span>使用済み: {item.spent}</span>
                        <span className="text-[#0f1c22]">残り使用可能: {item.remaining}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#e0e6eb] bg-white p-3 shadow-[0_8px_18px_rgba(16,38,49,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                  <h4 className="text-xs font-semibold text-[#0d2b32]">支出の内訳</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-0.5 text-[0.55rem] font-semibold text-[#0f1c22]">
                      支出詳細
                    </span>
                    <span className="rounded-2xl border border-[#d7dee4] bg-[#f7f9fb] px-2 py-1 text-[0.55rem] font-semibold text-[#0d2b32]">
                      支出合計: ¥123,400
                    </span>
                  </div>
                </div>
                <div className="grid items-center gap-2 md:grid-cols-[1fr_120px]">
                  <div className="flex items-center justify-center rounded-2xl border border-[#e0e6eb] bg-white p-3">
                    <div
                      className="h-24 w-24 rounded-full"
                      style={{
                        background:
                          'conic-gradient(#1f927f 0% 36%, #C36BB3 36% 50%, #C19A2E 50% 60%, #5b8def 60% 75%, #d97757 75% 100%)',
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-2xl border border-[#e0e6eb] bg-[#fbfbfc] p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.55rem] font-semibold text-[#5d6a72]">
                        カテゴリ内訳
                      </span>
                      <span className="inline-flex rounded-full border border-[#1a7b6d] bg-[linear-gradient(135deg,#1b7a6c,#2a9280)] px-2 py-0.5 text-[0.5rem] font-semibold text-[#f6fffb] shadow-[0_3px_8px_rgba(31,146,127,0.28)]">
                        ＋支出
                      </span>
                    </div>
                    {[
                      { name: '食費', color: '#1f927f', value: '¥45,000' },
                      { name: '日用品', color: '#C36BB3', value: '¥18,000' },
                      { name: '交通費', color: '#C19A2E', value: '¥12,000' },
                    ].map((item) => (
                      <div key={item.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-[0.6rem] font-medium text-[#0f1c22]">
                            {item.name}
                          </span>
                        </span>
                        <span className="text-[0.6rem] font-semibold text-[#0f1c22]">
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e0e6eb] bg-white p-3 shadow-[0_8px_18px_rgba(16,38,49,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-[#0d2b32]">年次レポート</h4>
                    <p className="mt-0.5 text-[0.55rem] text-[#5d6a72]">
                      月別の積み上げと年間合計
                    </p>
                  </div>
                  <span className="rounded-full border border-[#d7dee4] bg-white px-2 py-1 text-[0.55rem] font-semibold text-[#0f1c22]">
                    年次レポートを見る
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "家計簿",
              desc: "カテゴリごとに予算を決め、支出を記録します。月の上限との差と、年ごとの推移も出ます。",
            },
            {
              title: "資産管理",
              desc: "銀行口座と現金、投資信託などの残高を日付ごとに残します。銀行明細は CSV から取り込めます。",
            },
            {
              title: "カード",
              desc: "カードの明細を CSV で取り込み、月ごとの利用額を出します。明細は家計簿の支出に紐付けられます。",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-[20px] border border-[#d7dee4] bg-white/70 p-5 shadow-[0_12px_30px_rgba(15,31,36,0.1)]"
            >
              <p className="text-lg font-bold text-[#0f1f24]">{feature.title}</p>
              <p className="mt-2 text-sm leading-7 text-[#4a5c63]">{feature.desc}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 rounded-[26px] border border-[#d7dee4] bg-white/80 p-6 shadow-[0_18px_40px_rgba(15,31,36,0.12)] md:grid-cols-[0.9fr,1.1fr]">
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold text-[#0f1f24]">使い方</h2>
            <p className="text-sm leading-7 text-[#4b5d64]">
              口座とカテゴリを登録したら、支出の記録と残高の更新を続けます。
              集計は自動です。
            </p>
          </div>
          <div className="grid gap-4">
            {[
              {
                step: "01",
                title: "口座とカテゴリを登録",
                desc: "銀行口座、現金、カード、金融資産と、支出カテゴリを作ります。カテゴリは親子の二段まで。",
              },
              {
                step: "02",
                title: "支出を記録し、残高を更新",
                desc: "支出は手入力か、取り込んだ明細からの紐付け。残高は日付ごとのスナップショットとして保存します。",
              },
              {
                step: "03",
                title: "月次と年次で確認",
                desc: "予算に対する使用率、カテゴリ別の内訳、口座ごとの残高を月単位で見ます。年次レポートは月別の積み上げです。"
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-[#e1e7ec] bg-[#f6f9fb] p-4"
              >
                <div className="flex items-center gap-3 text-sm font-semibold text-[#1a7b6d]">
                  <span className="rounded-full border border-[#b7ddd6] bg-white px-3 py-1">
                    {item.step}
                  </span>
                  <span>{item.title}</span>
                </div>
                <p className="mt-2 text-sm leading-7 text-[#4a5c63]">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

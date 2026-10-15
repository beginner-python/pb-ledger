// カテゴリの色解決ユーティリティ。
//
// 設計方針:
// - 「色フィールド (color) の値だけ」で自動/手動を判定する。
//   空文字列または null → 自動 (カテゴリ名ハッシュで決定)、有効な HEX → 手動。
// - 自動色は描画時に毎回計算する純粋関数。DB やキャッシュには保存しない。
// - 「自動か手動か」を表す boolean フラグは追加しない (状態が1つに保たれる)。
// - 手動色は自動色で上書きされない (ユーザーの選択を尊重)。
// - HSL の彩度・明度は固定し、hue のみハッシュで散らすことでトーン統一。

export const DEFAULT_MANUAL_COLOR = '#1f927f'
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value)
}

// (h * 31 + charCode) >>> 0 方式。日本語・英語・絵文字いずれでも安定。
// >>> 0 で符号なし32bit整数に丸める (負数防止)。
function hashHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  return h % 360
}

// HSL → HEX 変換 (h: 0-359, s/l: 0-100).
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const value = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value).toString(16).padStart(2, '0').toUpperCase()
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// 単色 (ドット・グラフ塗り・バー塗り用) を HEX で返す。
// 白背景で読みやすく、トーンを揃えるため彩度65% / 明度42%固定。
// HEX で返すのは native <input type="color"> が HEX しか受け付けないため
// (ピッカーの値として直接渡せるようにする)。
export function autoCategoryColor(name: string): string {
  const hue = hashHue(name)
  return hslToHex(hue, 65, 42)
}

// 表示用の色を解決する。手動 (有効なHEX) があればそれを優先、
// なければカテゴリ名から自動生成する。呼び出し側はこの関数だけを使い、
// 自動/手動の分岐を一箇所に閉じ込める。
export function resolveCategoryColor(
  name: string,
  explicit: string | null | undefined,
): string {
  if (explicit && isValidHexColor(explicit)) {
    return explicit
  }
  return autoCategoryColor(name)
}

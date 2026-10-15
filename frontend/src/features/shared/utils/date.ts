/** ローカル日付を YYYY-MM-DD で返す。toISOString は UTC 基準で JST の早朝に前日になるため使わない。 */
export const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const todayString = (): string => toLocalDateString(new Date())

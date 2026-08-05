const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 本地日期 YYYY-MM-DD（用于跨日切分） */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 中文日期标签：2026年8月5日（星期三） */
export function localDateLabel(date: Date = new Date()): string {
  const weekday = WEEKDAYS[date.getDay()] ?? '日'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（星期${weekday}）`
}

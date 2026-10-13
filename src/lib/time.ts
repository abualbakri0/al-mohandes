// تنسيق الوقت بنظام 12 ساعة للعرض فقط.
// الدخل من قاعدة البيانات يبقى 24 ساعة ("14:30")، والعرض يتحول ("2:30 م").

/** "14:05" -> "2:05 م" ، "09:00" -> "9:00 ص" ، "12:00" -> "12:00 م" */
export function formatTime12(t: string | null | undefined): string {
  if (!t) return '';
  const parts = String(t).split(':');
  if (parts.length < 2) return String(t);
  const h = Number(parts[0]);
  const m = parts[1].padStart(2, '0');
  if (Number.isNaN(h)) return String(t);
  const period = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/** "10:00"-"12:00" -> "10:00 ص - 12:00 م" */
export function formatTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return '';
  if (!start) return formatTime12(end);
  if (!end) return formatTime12(start);
  return `${formatTime12(start)} - ${formatTime12(end)}`;
}

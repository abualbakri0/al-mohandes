// تنسيق الوقت بنظام 12 ساعة للعرض فقط.
// الدخل من قاعدة البيانات يبقى 24 ساعة ("14:30")، والعرض يتحول ("2:30 م").
//
// الشكل المطلوب على الشاشة (قراءة عربية من اليمين لليسار):
//   8:00 ص - 10:00 ص
// أي أن حرف الفترة (ص/م) يظهر على **يسار** الرقم، وترتيب المدى يبدأ من اليمين.
//
// ملاحظة حول اتجاه النص (Bidi):
// الأرقام تُعرض دائماً من اليسار لليمين، أما حرف الفترة العربي (ص/م) فهو RTL.
// لذلك نعزل الوقت بعلامتي العزل RLI (U+2067) و PDI (U+2069):
//   - RLI يجعل محتوى الوقت وحدة عربية مستقلة، فيظهر الرقم أولاً ثم حرف فترته
//     على يساره، بغض النظر عن سياق الصفحة.
//   - العزل يمنع التمزق، فلا ينفصل الرقم عن فترته ولا ينقلب الترتيب.
//
// لماذا RLI وليس LRI؟ لأن LRI يجعل الوقت وحدة LTR فيظهر حرف الفترة على يمين
// الرقم ("8:00 ص")، بينما RLI يعطيه الاتجاه العربي فتقع الفترة يسار الرقم.
//
// مهم: لا تضع dir="ltr" على عنصر يعرض مدى زمني؛ العزل هنا يكفي وحده.

const RLI = '\u2067'; // Right-To-Left Isolate — يبدأ عزلاً باتجاه RTL
const PDI = '\u2069'; // Pop Directional Isolate — ينهي العزل

/** يعزل الوقت اتجاهياً (RTL) حتى تظهر فترته على يسار الرقم في أي سياق. */
export function isolateTime(text: string): string {
  return `${RLI}${text}${PDI}`;
}

/** "14:05" -> "2:05 م" ، "09:00" -> "9:00 ص" ، "12:00" -> "12:00 م" */
function time12Plain(t: string | null | undefined): string {
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

/** "14:05" -> "2:05 م" معزول اتجاهياً (الفترة تظهر يسار الرقم). */
export function formatTime12(t: string | null | undefined): string {
  if (!t) return '';
  return isolateTime(time12Plain(t));
}

/** "10:00"-"12:00" -> "10:00 ص - 12:00 م" (البداية يميناً والنهاية يساراً) */
export function formatTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return '';
  if (!start) return formatTime12(end);
  if (!end) return formatTime12(start);
  // نعزل المدى بالكامل مرة واحدة حتى تبقى الشرطة في موضعها الصحيح.
  return isolateTime(`${time12Plain(start)} - ${time12Plain(end)}`);
}

// تقرير الإنجاز الأسبوعي — حسابات محلية فقط (Weekly Study Analytics).
// - لا استعلامات جديدة، لا تعديل DB/RLS/جلسات/إشعارات.
// - يعمل على نفس بيانات StudyView المحملة أصلاً (visibleTasks + progress).
// - النافذة: مهام الأسبوع الظاهرة تراكمياً حتى اليوم (آخر 7 أيام عملياً).

import { useMemo, useState } from 'react';
import { BarChart3, Clock3, Sparkles, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import type { StudyTask } from '@/lib/supabase';

export type WeeklyAnalyticsInput = {
  visibleTasks: StudyTask[];
  isDone: (task: StudyTask) => boolean;
  userId?: string;
};

/** مدة المهمة بالدقائق من start_time/end_time. */
function taskMinutes(task: StudyTask): number {
  try {
    const [sh, sm] = task.start_time.split(':').map(Number);
    const [eh, em] = task.end_time.split(':').map(Number);
    if ([sh, sm, eh, em].some((v) => Number.isNaN(v))) return 0;
    let total = eh * 60 + em - (sh * 60 + sm);
    if (total < 0) total += 24 * 60;
    return Math.max(0, total);
  } catch {
    return 0;
  }
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h} س ${m} د`;
  if (h > 0) return `${h} س`;
  if (m > 0) return `${m} د`;
  return '٠';
}

function pickInsight(args: { pct: number; weakestName: string | null; weakestPct: number; total: number }): { text: string; kind: 'warn' | 'tip' | 'praise' } {
  const { pct, weakestName, weakestPct, total } = args;
  if (total === 0) return { text: 'ابدأ بأسهل مهمة في القائمة — أول خطوة تكسر الجمود.', kind: 'tip' };
  if (weakestName && weakestPct < 50) {
    return { text: `«${weakestName}» تحتاج دفعة (${weakestPct}%). ركّز جلسة إضافية قصيرة عليها اليوم — التقدم الصغير المتراكم يصنع الفرق.`, kind: 'warn' };
  }
  if (pct >= 75) return { text: 'ممتاز! أنت متقدم — راجع ما أنجزته سريعاً ثم وسّع الفارق.', kind: 'praise' };
  if (pct >= 40) return { text: 'أداء متوازن! وزّع نفس الجهد على بقية الأسبوع وحافظ على الاستمرارية.', kind: 'tip' };
  return { text: 'ابدأ بأسهل مهمة في القائمة — أول خطوة تكسر الجمود.', kind: 'tip' };
}

export default function WeeklyAnalytics({ visibleTasks, isDone, userId }: WeeklyAnalyticsInput) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`weekly_analytics_collapsed_${userId ?? 'shared'}`) === '1';
    } catch {
      return false;
    }
  });

  const stats = useMemo(() => {
    const total = visibleTasks.length;
    const doneList = visibleTasks.filter(isDone);
    const done = doneList.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const doneMinutes = doneList.reduce((s, t) => s + taskMinutes(t), 0);
    const plannedMinutes = visibleTasks.reduce((s, t) => s + taskMinutes(t), 0);
    const bySubject = new Map<string, { total: number; done: number; minutes: number }>();
    for (const t of visibleTasks) {
      const key = (t.subject ?? '').trim() || 'بدون مادة';
      const cur = bySubject.get(key) ?? { total: 0, done: 0, minutes: 0 };
      cur.total += 1;
      if (isDone(t)) {
        cur.done += 1;
        cur.minutes += taskMinutes(t);
      }
      bySubject.set(key, cur);
    }
    const subjects = Array.from(bySubject.entries())
      .map(([subject, v]) => ({
        subject,
        total: v.total,
        done: v.done,
        minutes: v.minutes,
        pct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total);
    const weakest = subjects.length > 0 ? subjects[0] : null;
    const insight = pickInsight({ pct, weakestName: weakest?.subject ?? null, weakestPct: weakest?.pct ?? 100, total });
    return { total, done, pct, doneMinutes, plannedMinutes, subjects, insight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTasks, userId]);

  if (stats.total === 0) return null;

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(`weekly_analytics_collapsed_${userId ?? 'shared'}`, next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  const ringColors = stats.pct >= 75 ? 'text-emerald-500' : stats.pct >= 40 ? 'text-indigo-500' : 'text-amber-500';
  const R = 26;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between p-5 text-right">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-500" />
          <span className="font-bold text-slate-700">تقرير الإنجاز الأسبوعي</span>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">آخر 7 أيام</span>
        </div>
        {collapsed ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronUp className="w-5 h-5 text-slate-400" />}
      </button>
      {!collapsed && (
        <div className="px-5 pb-5 space-y-5 animate-fade-in-up">
          <div className="flex items-center gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
            <div className="relative w-[72px] h-[72px] flex-shrink-0">
              <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
                <circle cx="32" cy="32" r={R} fill="none" strokeWidth="8" className="stroke-slate-200" />
                <circle cx="32" cy="32" r={R} fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC - (CIRC * stats.pct) / 100} className={`${ringColors} transition-all duration-700`} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-slate-700">{stats.pct}%</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-700">إنجاز خطة الأسبوع</p>
              <p className="text-sm text-slate-500 mt-0.5">{stats.done} من {stats.total} مهام مكتملة</p>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <Clock3 className="w-3.5 h-3.5" />
                ساعات المذاكرة المنجزة: {formatHours(stats.doneMinutes)}
                {stats.plannedMinutes > 0 && ` من ${formatHours(stats.plannedMinutes)} مخططة`}
              </p>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-600 mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              إنجاز كل مادة
            </p>
            <div className="space-y-2.5">
              {stats.subjects.slice(0, 6).map((s) => (
                <div key={s.subject}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-semibold text-slate-700 truncate ml-2">{s.subject}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{s.done}/{s.total} • {formatHours(s.minutes)} • {s.pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${s.pct >= 75 ? 'bg-emerald-500' : s.pct >= 40 ? 'bg-indigo-500' : 'bg-amber-400'}`} style={{ width: `${s.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-2xl p-4 border flex items-start gap-3 ${stats.insight.kind === 'warn' ? 'bg-amber-50 border-amber-200' : stats.insight.kind === 'praise' ? 'bg-emerald-50 border-emerald-200' : 'bg-indigo-50 border-indigo-200'}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${stats.insight.kind === 'warn' ? 'bg-amber-400' : stats.insight.kind === 'praise' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700 mb-0.5">ملاحظة ذكية</p>
              <p className="text-sm text-slate-600 leading-relaxed">{stats.insight.text}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

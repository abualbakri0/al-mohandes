import { useState } from 'react';
import { CalendarDays, Bell, X, Sun, Coffee, ClipboardList, FileText } from 'lucide-react';
import type { NightAlert } from '@/hooks/useNightAlerts';
import { formatTimeRange, formatTime12 } from '@/lib/time';

type Props = {
  alert: NightAlert;
  userName: string;
  onClose: () => void;
};

export default function NightAlertBanner({ alert, userName, onClose }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isHoliday = alert.type === 'holiday';
  // Cached alerts from older app versions may predate these fields.
  const dueAssignments = alert.assignments ?? [];
  const dayExams = alert.exams ?? [];
  const hasLectures = alert.lectures.length > 0;
  const title = isHoliday
    ? 'إجازة غداً'
    : hasLectures
      ? `محاضرات غداً — ${alert.dayName}`
      : `برنامج غداً — ${alert.dayName}`;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-50 animate-fade-in-up mb-[env(safe-area-inset-bottom,0px)]">
      <div className={`rounded-2xl shadow-2xl overflow-hidden border ${
        isHoliday ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400' : 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700'
      }`}>
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isHoliday ? 'bg-white/20' : 'bg-teal-500/20'
              }`}>
                {isHoliday ? <Coffee className="w-5 h-5 text-white" /> : <Bell className="w-5 h-5 text-teal-300" />}
              </div>
              <div>
                <p className="text-white font-bold text-sm">{title}</p>
              </div>
            </div>
            <button
              onClick={() => { setDismissed(true); onClose(); }}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="text-white/90 text-sm">
            <p className="mb-2">
              <Sun className="w-4 h-4 inline ml-1" />
              مساء الخير {userName}،
            </p>
            {isHoliday ? (
              <p className="leading-relaxed">
                غداً يوم {alert.dayName} ولا يوجد شيء مبرمج في جدولك. استمتع بإجازتك واقضِ وقتاً في المراجعة إن أردت.
              </p>
            ) : (
              <div className="space-y-2">
                {hasLectures && (
                  <div className="space-y-1.5">
                    <p className="mb-1">لديك {alert.lectures.length} محاضرة غداً:</p>
                    {alert.lectures.map((lec, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                        <CalendarDays className="w-4 h-4 text-teal-300 flex-shrink-0" />
                        <span className="font-medium">{lec.subject}</span>
                        <span className="text-white/60 text-xs mr-auto">{formatTimeRange(lec.start_time, lec.end_time)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dueAssignments.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="mb-1">تسليم تكاليف ({dueAssignments.length}):</p>
                    {dueAssignments.map((asg) => (
                      <div key={asg.id} className="flex items-center gap-2 bg-amber-400/15 rounded-lg px-3 py-2">
                        <ClipboardList className="w-4 h-4 text-amber-300 flex-shrink-0" />
                        <span className="font-medium">{asg.subject}: {asg.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dayExams.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="mb-1">اختبارات ({dayExams.length}):</p>
                    {dayExams.map((exm) => (
                      <div key={exm.id} className="flex items-center gap-2 bg-rose-400/15 rounded-lg px-3 py-2">
                        <FileText className="w-4 h-4 text-rose-300 flex-shrink-0" />
                        <span className="font-medium">{exm.subject}</span>
                        <span className="text-white/60 text-xs mr-auto">{formatTime12(exm.start_time)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

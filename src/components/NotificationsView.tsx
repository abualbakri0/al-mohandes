import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, Bell, Clock, AlertTriangle, Info, Megaphone, Cpu, Zap, Users, CloudUpload } from 'lucide-react';
import { DEPARTMENT_OPTIONS, displayDepartment, type Notification, type Department } from '@/lib/supabase';
import { fetchNotifications, addNotification, updateNotification, deleteNotification } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { runOrQueue } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';

type Props = {
  isDeveloper: boolean;
  department?: Department;
};

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diff < 60) return 'الآن';
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} يوم`;
  return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

const TYPE_CONFIG = {
  postponement: {
    label: 'تأجيل',
    icon: AlertTriangle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    accent: 'bg-red-500',
  },
  reminder: {
    label: 'تذكير',
    icon: Clock,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    accent: 'bg-amber-500',
  },
  general: {
    label: 'عام',
    icon: Info,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    accent: 'bg-blue-500',
  },
} as const;

export default function NotificationsView({ isDeveloper, department }: Props) {
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<(Notification & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'postponement' | 'general' | 'reminder'>('general');
  const [targetDept, setTargetDept] = useState<Department | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: keep showing the last known notifications on failure.
      const res = await fetchWithCache<Notification>('notifications', department, () => fetchNotifications(department));
      setNotifications(res.rows);
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setTitle('');
    setMessage('');
    setType('general');
    setTargetDept('all');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (notification: Notification) => {
    setEditingId(notification.id);
    setTitle(notification.title);
    setMessage(notification.message);
    setType(notification.notification_type);
    setTargetDept(notification.department ?? 'all');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    setSubmitting(true);
    const fields = {
      title: title.trim(),
      message: message.trim(),
      notification_type: type,
      department: targetDept === 'all' ? null : targetDept,
    };
    try {
      if (editingId) {
        if (isPendingId(editingId)) {
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...fields, row: { ...(notifications.find((n) => n.id === editingId) ?? {}), ...fields } },
            label: `تعديل إشعار (محلي): ${fields.title}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'notifications', action: 'update', payload: { id: editingId, fields }, label: `تعديل إشعار: ${fields.title}` },
            () => updateNotification(editingId, fields)
          );
          if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        }
      } else {
        const res = await runOrQueue(
          {
            table: 'notifications',
            action: 'insert',
            payload: {
              ...fields,
              row: { id: '', created_at: new Date().toISOString(), ...fields },
            },
            label: `إضافة إشعار: ${fields.title}`,
          },
          () => addNotification(fields.title, fields.message, fields.notification_type, fields.department)
        );
        if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُرسل الإشعار تلقائيًا عند عودة الاتصال', 'info');
      }
      resetForm();
      await load();
    } catch {
      showToast('تعذر الحفظ', 'حدث خطأ غير متوقع. حاول مرة أخرى.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isPendingId(id)) {
      dequeue(id.slice('pending_'.length));
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'notifications', action: 'delete', payload: { id }, label: 'حذف إشعار' },
        () => deleteNotification(id)
      );
      if (res.status === 'queued') showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center shadow-md">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">الإشعارات الرسمية</h2>
            <p className="text-sm text-slate-500">{notifications.length} إشعار</p>
          </div>
        </div>
        {isDeveloper && (
          <button
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setEditingId(null);
                setShowForm(true);
              }
            }}
            className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="w-5 h-5" />
            إرسال إشعار
          </button>
        )}
      </div>

      {showForm && isDeveloper && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 animate-scale-in"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">العنوان</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان الإشعار"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الرسالة</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="محتوى الإشعار..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent transition-all resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">النوع</label>
            <div className="flex gap-2 flex-wrap">
              {(['general', 'reminder', 'postponement'] as const).map((t) => {
                const cfg = TYPE_CONFIG[t];
                const Icon = cfg.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      type === t
                        ? `${cfg.iconBg} ${cfg.iconColor} ring-2 ring-offset-1`
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    style={type === t ? { boxShadow: '0 0 0 2px currentColor' } : undefined}
                  >
                    <Icon className="w-4 h-4" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الموجه إلى</label>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setTargetDept('all')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  targetDept === 'all'
                    ? 'bg-slate-200 text-slate-700 ring-2 ring-slate-400'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <Users className="w-4 h-4" />
                الجميع
              </button>
              {DEPARTMENT_OPTIONS.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setTargetDept(dept.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    targetDept === dept.id
                      ? dept.id === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700 ring-2 ring-cyan-400' : dept.id === 'كهربائية' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400' : 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {dept.id === 'ميكاترونكس' ? <Cpu className="w-4 h-4" /> : dept.id === 'كهربائية' ? <Zap className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {dept.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-rose-500 hover:bg-rose-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
              إرسال
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-6 py-2.5 rounded-xl transition-all"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">لا توجد إشعارات.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const cfg = TYPE_CONFIG[notification.notification_type] || TYPE_CONFIG.general;
            const Icon = cfg.icon;

            return (
              <div
                key={notification.id}
                className={`rounded-2xl border-2 ${cfg.border} ${cfg.bg} p-5 transition-all group animate-slide-in shadow-sm`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl ${cfg.iconBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                    <Icon className={`w-6 h-6 ${cfg.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-900 text-base">{notification.title}</h4>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${cfg.iconBg} ${cfg.iconColor} border ${cfg.border}`}>
                        {cfg.label}
                      </span>
                      {notification.__pending && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          <CloudUpload className="w-3 h-3" />
                          بانتظار النشر
                        </span>
                      )}
                      {notification.department && (
                        <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          notification.department === 'ميكاترونكس' ? 'bg-cyan-100 text-cyan-700' : notification.department === 'كهربائية' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {notification.department === 'ميكاترونكس' ? <Cpu className="w-3 h-3" /> : notification.department === 'كهربائية' ? <Zap className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                          {displayDepartment(notification.department)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-2 leading-relaxed border-r-2 border-slate-200 pr-3">{notification.message}</p>
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-200/50">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <p className="text-xs text-slate-400">{formatRelative(notification.created_at)}</p>
                    </div>
                  </div>
                  {isDeveloper && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(notification)}
                        title={notification.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(notification.id)}
                        title={notification.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:bg-red-100 hover:text-red-600 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

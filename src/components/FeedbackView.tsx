import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Trash2, Loader2, CheckCircle2, Circle, Phone, Clock, Mail, AlertCircle, Lightbulb, HelpCircle, User as UserIcon } from 'lucide-react';
import { FEEDBACK_TYPES, type FeedbackType, type FeedbackMessage } from '@/lib/supabase';
import { fetchFeedback, addFeedback, markFeedbackRead, deleteFeedback } from '@/lib/api';

type Props = {
  isDeveloper: boolean;
  userName: string;
  userPhone: string;
};

const TYPE_CONFIG: Record<FeedbackType, { label: string; icon: typeof AlertCircle; bg: string; border: string; iconBg: string; iconColor: string; accent: string }> = {
  complaint: { label: 'شكوى', icon: AlertCircle, bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100', iconColor: 'text-red-600', accent: 'bg-red-500' },
  suggestion: { label: 'اقتراح', icon: Lightbulb, bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', accent: 'bg-amber-500' },
  question: { label: 'استفسار', icon: HelpCircle, bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', accent: 'bg-blue-500' },
  other: { label: 'أخرى', icon: Mail, bg: 'bg-slate-50', border: 'border-slate-200', iconBg: 'bg-slate-100', iconColor: 'text-slate-600', accent: 'bg-slate-500' },
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

export default function FeedbackView({ isDeveloper, userName, userPhone }: Props) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<FeedbackType>('suggestion');
  const [includePhone, setIncludePhone] = useState(false);
  const [phone, setPhone] = useState(userPhone);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMessages(await fetchFeedback());
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    try {
      await addFeedback(
        userName,
        includePhone ? phone.trim() : null,
        type,
        subject.trim(),
        message.trim()
      );
      setSubject('');
      setMessage('');
      setType('suggestion');
      setIncludePhone(false);
      setSent(true);
      setTimeout(() => setSent(false), 4000);
      await load();
    } catch {
      alert('حدث خطأ أثناء إرسال الرسالة. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRead = async (id: string, isRead: boolean) => {
    try {
      await markFeedbackRead(id, !isRead);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: !isRead } : m)));
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه الرسالة؟')) return;
    try {
      await deleteFeedback(id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch {
      alert('حدث خطأ أثناء الحذف');
    }
  };

  if (isDeveloper) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center shadow-md">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">رسائل المستخدمين</h2>
            <p className="text-sm text-slate-500">
              {messages.length} رسالة
              {messages.filter((m) => !m.is_read).length > 0 && (
                <span className="text-red-500 font-medium"> — {messages.filter((m) => !m.is_read).length} غير مقروءة</span>
              )}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">لا توجد رسائل بعد.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const cfg = TYPE_CONFIG[msg.message_type] ?? TYPE_CONFIG.other;
              const Icon = cfg.icon;
              return (
                <div
                  key={msg.id}
                  className={`rounded-2xl border-2 ${cfg.border} ${cfg.bg} p-5 transition-all group animate-slide-in shadow-sm ${
                    !msg.is_read ? 'ring-2 ring-offset-1 ring-violet-300' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl ${cfg.iconBg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <Icon className={`w-6 h-6 ${cfg.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900">{msg.subject}</h4>
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${cfg.iconBg} ${cfg.iconColor} border ${cfg.border}`}>
                          {cfg.label}
                        </span>
                        {!msg.is_read && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                            جديد
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 mt-2 leading-relaxed border-r-2 border-slate-200 pr-3">{msg.message}</p>
                      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-slate-200/50 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <UserIcon className="w-3.5 h-3.5" />
                          {msg.sender_name}
                        </span>
                        {msg.sender_phone && (
                          <span className="flex items-center gap-1 text-xs text-slate-500" dir="ltr">
                            <Phone className="w-3.5 h-3.5" />
                            {msg.sender_phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          {formatRelative(msg.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleToggleRead(msg.id, msg.is_read)}
                        className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-all"
                        title={msg.is_read ? 'تحديد كغير مقروء' : 'تحديد كمقروء'}
                      >
                        {msg.is_read ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(msg.id)}
                        className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center shadow-md">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800">تواصل مع المطور</h2>
          <p className="text-sm text-slate-500">أرسل شكوى، اقتراح، أو استفسار</p>
        </div>
      </div>

      {sent && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 animate-scale-in">
          <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">تم إرسال رسالتك بنجاح!</p>
            <p className="text-sm text-green-600">سيطلع المطور على رسالتك في أقرب وقت.</p>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">نوع الرسالة</label>
          <div className="flex gap-2 flex-wrap">
            {FEEDBACK_TYPES.map((t) => {
              const cfg = TYPE_CONFIG[t.id];
              const Icon = cfg.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    type === t.id
                      ? `${cfg.iconBg} ${cfg.iconColor} ring-2 ring-offset-1`
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                  style={type === t.id ? { boxShadow: '0 0 0 2px currentColor' } : undefined}
                >
                  <Icon className="w-4 h-4" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">الموضوع</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="عنوان مختصر لرسالتك"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">الرسالة</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب رسالتك هنا بالتفصيل..."
            rows={5}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all resize-none"
            required
          />
        </div>

        <div>
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200">
            <button
              type="button"
              onClick={() => setIncludePhone(!includePhone)}
              className={`relative w-12 h-6 rounded-full transition-all ${includePhone ? 'bg-violet-500' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${includePhone ? 'left-0.5' : 'right-0.5'}`} />
            </button>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">إرفاق رقم هاتفي للتواصل</span>
            </div>
          </div>
          {includePhone && (
            <div className="mt-3 animate-fade-in">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="رقم الهاتف"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-all"
                dir="ltr"
              />
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !subject.trim() || !message.trim()}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3.5 rounded-xl transition-all disabled:opacity-60 shadow-lg hover:shadow-xl"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          إرسال الرسالة
        </button>
      </form>
    </div>
  );
}

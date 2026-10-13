// User-controllable notification preferences (stored locally).
// contentAlerts: new lectures/assignments/exams/references/notifications (+ dev: registrations/feedback)
// lectureReminders: remind 60min & 15min before each lecture
// eveningSummary: daily 19:00 summary of tomorrow's lectures
// assignmentReminders: one day before each assignment's due date (20:00),
// even for completed ones

export type NotificationPrefs = {
  contentAlerts: boolean;
  lectureReminders: boolean;
  eveningSummary: boolean;
  studyMotivation: boolean;
  assignmentReminders: boolean;
};

const KEY = 'mohanndes_notif_prefs';

const DEFAULTS: NotificationPrefs = {
  contentAlerts: true,
  lectureReminders: true,
  eveningSummary: true,
  studyMotivation: true,
  assignmentReminders: true,
};

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      contentAlerts: parsed.contentAlerts !== false,
      lectureReminders: parsed.lectureReminders !== false,
      eveningSummary: parsed.eveningSummary !== false,
      studyMotivation: parsed.studyMotivation !== false,
      assignmentReminders: parsed.assignmentReminders !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...getNotificationPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  // Let the FCM push layer (src/lib/push.ts) re-upload alerts_enabled so the
  // server stops pushing while the app is closed if the user disabled alerts.
  try {
    window.dispatchEvent(new Event('mohanndes-notif-prefs-changed'));
  } catch {
    // ignore
  }
  return next;
}

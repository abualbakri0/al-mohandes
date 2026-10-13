// ============================================================
// Downloaded references registry — per account (phone-based).
// Files themselves live in Capacitor Filesystem (persistent on
// device). This registry only remembers *which* ref was downloaded
// and where, so the UI shows "فتح" directly after re-entering
// the section or restarting the app — no re-download needed.
// Key is scoped per account: mohanndes_downloads_<phone>
// ============================================================

export type DownloadedRefEntry = {
  uri: string;
  contentType: string;
  /** Relative file name inside FilesystemDirectory.Data */
  fileName: string;
  downloadedAt: string;
  /** Server path, used to detect stale entries if file changes */
  filePath: string;
};

function safeRead(key: string): Record<string, DownloadedRefEntry> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DownloadedRefEntry>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function safeWrite(key: string, value: Record<string, DownloadedRefEntry>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full — ignore */
  }
}

/** Resolve the storage key for the current account. */
export function downloadsKey(accountKey?: string | null): string {
  let phone = (accountKey ?? '').trim();
  if (!phone) {
    try {
      const raw = localStorage.getItem('univ_user');
      if (raw) {
        const parsed = JSON.parse(raw) as { phone?: string };
        if (parsed?.phone) phone = String(parsed.phone);
      }
    } catch {
      /* ignore */
    }
  }
  const safe = phone ? phone.replace(/[^0-9+]/g, '') || 'shared' : 'shared';
  return `mohanndes_downloads_${safe}`;
}

export function loadDownloadMap(accountKey?: string | null): Record<string, DownloadedRefEntry> {
  return safeRead(downloadsKey(accountKey));
}

export function saveDownloaded(
  accountKey: string | null | undefined,
  refId: string,
  entry: DownloadedRefEntry
): void {
  const key = downloadsKey(accountKey);
  const map = safeRead(key);
  map[refId] = entry;
  safeWrite(key, map);
}

export function removeDownloaded(accountKey: string | null | undefined, refId: string): void {
  const key = downloadsKey(accountKey);
  const map = safeRead(key);
  if (map[refId]) {
    delete map[refId];
    safeWrite(key, map);
  }
}

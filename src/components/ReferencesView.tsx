import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Loader2, BookMarked, Download, Upload, FileText, Cpu, Zap, Users, X, CloudUpload, ExternalLink, Pause, Play } from 'lucide-react';
import { Filesystem, FilesystemDirectory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { FileOpener } from '@capacitor-community/file-opener';
import { DEPARTMENT_OPTIONS, displayDepartment, type Department, type ReferenceMaterial } from '@/lib/supabase';
import { fetchReferences, addReference, deleteReference, updateReference, uploadReferenceFile } from '@/lib/api';
import { fetchWithCache, isPendingId, updateQueuedOp, dequeue } from '@/lib/offlineStore';
import { loadDownloadMap, saveDownloaded, removeDownloaded } from '@/lib/downloadedRefs';
import { runOrQueue, MAX_OFFLINE_FILE_BYTES } from '@/lib/offlineSync';
import { useToast } from '@/components/ToastProvider';
import { supabase } from '@/lib/supabase';

type Props = {
  isDeveloper: boolean;
  department?: Department;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEPT_BADGE: Record<string, string> = {
  'ميكاترونكس': 'bg-cyan-100 text-cyan-700',
  'كهربائية': 'bg-amber-100 text-amber-700',
  'مشترك': 'bg-emerald-100 text-emerald-700',
};

function DeptIcon({ dept, className }: { dept: string; className?: string }) {
  if (dept === 'ميكاترونكس') return <Cpu className={className} />;
  if (dept === 'كهربائية') return <Zap className={className} />;
  return <Users className={className} />;
}

export default function ReferencesView({ isDeveloper, department }: Props) {
  const { showToast } = useToast();
  const [references, setReferences] = useState<(ReferenceMaterial & { __pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [openable, setOpenable] = useState<Record<string, { uri: string; contentType: string }>>({});
  const webUrlsRef = useRef<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Clean up web blob URLs on unmount.
  useEffect(() => {
    const cache = webUrlsRef.current;
    return () => {
      Object.values(cache).forEach((url) => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      });
    };
  }, []);

  // Restore previously downloaded files for THIS account:
  // validate each saved entry still exists on disk, then mark it openable
  // so the button shows "فتح" immediately — no re-download.
  const restoreDownloads = useCallback(async () => {
    const map = loadDownloadMap();
    const ids = Object.keys(map);
    if (ids.length === 0) return;
    const restored: Record<string, { uri: string; contentType: string }> = {};
    const isNative = (() => {
      try { return Capacitor.isNativePlatform(); } catch { return false; }
    })();
    await Promise.all(ids.map(async (id) => {
      const entry = map[id];
      if (!entry?.fileName) {
        removeDownloaded(null, id);
        return;
      }
      try {
        if (isNative) {
          await Filesystem.stat({ path: entry.fileName, directory: FilesystemDirectory.Data });
          const uriResult = await Filesystem.getUri({ path: entry.fileName, directory: FilesystemDirectory.Data });
          restored[id] = { uri: uriResult.uri || entry.uri, contentType: entry.contentType || 'application/pdf' };
        } else {
          // Web: Filesystem persists via IndexedDB — read the file and
          // rebuild a blob URL so "فتح" works without re-downloading.
          const read = await Filesystem.readFile({ path: entry.fileName, directory: FilesystemDirectory.Data });
          const base64 = typeof read.data === 'string' ? read.data : '';
          if (!base64) throw new Error('empty');
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: entry.contentType || 'application/pdf' });
          const url = URL.createObjectURL(blob);
          webUrlsRef.current[id] = url;
          restored[id] = { uri: url, contentType: entry.contentType || 'application/pdf' };
        }
      } catch {
        // File no longer on disk — drop the stale entry.
        removeDownloaded(null, id);
      }
    }));
    if (Object.keys(restored).length > 0) {
      setOpenable((prev) => ({ ...prev, ...restored }));
    }
  }, []);

  useEffect(() => {
    restoreDownloads();
  }, [restoreDownloads]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDept, setSelectedDept] = useState<Department | 'all'>('all');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Offline-first: keep the last list visible when the network fails.
      const res = await fetchWithCache<ReferenceMaterial>('reference_materials', department, () => fetchReferences(department));
      setReferences(res.rows);
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSelectedFile(null);
    setSelectedDept('all');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (ref: ReferenceMaterial) => {
    setEditingId(ref.id);
    setTitle(ref.title);
    setDescription(ref.description ?? '');
    setSelectedDept(ref.department ?? 'all');
    setSelectedFile(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else if (file) {
      alert('الرجاء اختيار ملف PDF فقط');
    }
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const fields = {
      title: title.trim(),
      description: description.trim(),
      department: selectedDept === 'all' ? null : (selectedDept as Department),
    };

    // ---- Edit mode: metadata only (no file needed) ----
    if (editingId) {
      try {
        if (isPendingId(editingId)) {
          const qid = editingId.slice('pending_'.length);
          updateQueuedOp(qid, {
            payload: { ...fields, row: { ...(references.find((r) => r.id === editingId) ?? {}), ...fields } },
            label: `تعديل مرجع (محلي): ${fields.title}`,
          });
          showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
        } else {
          const res = await runOrQueue(
            { table: 'reference_materials', action: 'update', payload: { id: editingId, fields }, label: `تعديل مرجع: ${fields.title}` },
            () => updateReference(editingId, fields)
          );
          if (res.status === 'queued') showToast('تم الحفظ محليًا', 'سيُنشر التعديل عند عودة الاتصال', 'info');
          else showToast('تم التعديل بنجاح', `تم تحديث المرجع «${fields.title}»`, 'success');
        }
        resetForm();
        await load();
      } catch {
        showToast('تعذر الحفظ', 'حدث خطأ غير متوقع. حاول مرة أخرى.', 'error');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---- Insert mode: a PDF file is required ----
    if (!title.trim() || !selectedFile) {
      setSubmitting(false);
      return;
    }
    const file = selectedFile;

    const queueWithFile = async () => {
      const dataUrl = await fileToDataUrl(file);
      // enqueue() is called directly because navigator.offline is already known.
      const { enqueue } = await import('@/lib/offlineStore');
      enqueue({
        table: 'reference_materials',
        action: 'insert',
        payload: { ...fields, dataUrl, fileName: file.name, row: { id: '', created_at: new Date().toISOString(), file_size: file.size, ...fields } },
        label: `إضافة مرجع: ${fields.title}`,
      });
      showToast('تم الحفظ محليًا', 'سيُرفع المرجع تلقائيًا عند عودة الاتصال', 'info');
      resetForm();
      await load();
    };

    // Offline path: store the PDF as a data-URL in the queue (≤ 2 MB).
    if (!navigator.onLine) {
      if (file.size > MAX_OFFLINE_FILE_BYTES) {
        showToast('الملف كبير جدًا', 'لا يمكن حفظ ملف أكبر من 2 ميغابايت دون اتصال. حاول لاحقًا.', 'warning');
        setSubmitting(false);
        return;
      }
      try {
        setUploadProgress('جاري حفظ الملف محليًا...');
        await queueWithFile();
      } catch {
        showToast('تعذر الحفظ', 'حدث خطأ أثناء الحفظ المحلي.', 'error');
      } finally {
        setSubmitting(false);
        setUploadProgress('');
      }
      return;
    }

    // Online path.
    try {
      setUploadProgress('جاري رفع الملف...');
      const { path, size } = await uploadReferenceFile(file);
      setUploadProgress('جاري حفظ البيانات...');
      await addReference(fields.title, fields.description, path, size, fields.department);
      resetForm();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? '');
      // Network died mid-upload → queue with the data-URL for retry later.
      if (/fetch|network|timeout|abort/i.test(msg) && file.size <= MAX_OFFLINE_FILE_BYTES) {
        try {
          await queueWithFile();
        } catch {
          alert('حدث خطأ أثناء رفع المرجع: ' + msg);
        }
      } else {
        alert('حدث خطأ أثناء رفع المرجع: ' + msg);
      }
    } finally {
      setSubmitting(false);
      setUploadProgress('');
    }
  };

  const clearLocalCopy = (id: string) => {
    // Forget the saved download for this account + drop the file from disk.
    const map = loadDownloadMap();
    const fileName = map[id]?.fileName ?? `${id}.pdf`;
    removeDownloaded(null, id);
    Filesystem.deleteFile({ path: fileName, directory: FilesystemDirectory.Data }).catch(() => {});
    if (webUrlsRef.current[id]) {
      try { URL.revokeObjectURL(webUrlsRef.current[id]); } catch { /* ignore */ }
      delete webUrlsRef.current[id];
    }
    setOpenable((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleDelete = async (id: string, filePath: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المرجع؟')) return;
    if (isPendingId(id)) {
      dequeue(id.slice('pending_'.length));
      setReferences((prev) => prev.filter((r) => r.id !== id));
      clearLocalCopy(id);
      return;
    }
    try {
      const res = await runOrQueue(
        { table: 'reference_materials', action: 'delete', payload: { id, filePath }, label: 'حذف مرجع' },
        () => deleteReference(id, filePath)
      );
      if (res.status === 'queued') showToast('تم الحذف محليًا', 'سيُنفّذ الحذف عند عودة الاتصال', 'info');
      setReferences((prev) => prev.filter((r) => r.id !== id));
      clearLocalCopy(id);
    } catch {
      alert('حدث خطأ أثناء حذف المرجع');
    }
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLoaded, setDownloadLoaded] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [downloadPaused, setDownloadPaused] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const downloadCtlRef = useRef<{ paused: boolean; cancelled: boolean } | null>(null);

  const toggleDownloadPause = useCallback(() => {
    const ctl = downloadCtlRef.current;
    if (!ctl) return;
    ctl.paused = !ctl.paused;
    setDownloadPaused(ctl.paused);
  }, []);

  const cancelDownload = useCallback(() => {
    const ctl = downloadCtlRef.current;
    if (!ctl) return;
    ctl.cancelled = true;
  }, []);

  const handleDownload = async (ref: ReferenceMaterial) => {
    if (downloadingId === ref.id) return;
    const ctl = { paused: false, cancelled: false };
    downloadCtlRef.current = ctl;
    setDownloadingId(ref.id);
    setDownloadProgress(0);
    setDownloadLoaded(0);
    setDownloadTotal(ref.file_size ?? 0);
    setDownloadPaused(false);
    setDownloadFailed(false);
    try {
      const publicUrl = supabase.storage.from('references').getPublicUrl(ref.file_path).data.publicUrl;
      const response = await fetch(publicUrl);
      if (!response.ok) throw new Error(`فشل التنزيل (${response.status})`);
      const total = Number(response.headers.get('content-length') ?? ref.file_size ?? 0);
      setDownloadTotal(total);
      let blob: Blob;
      if (response.body && typeof window.ReadableStream !== 'undefined') {
        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;
        let lastTick = 0;
        for (;;) {
          while (ctl.paused && !ctl.cancelled) {
            await new Promise((r) => setTimeout(r, 150));
          }
          if (ctl.cancelled) {
            try { await reader.cancel(); } catch { /* ignore */ }
            throw new Error('CANCELLED');
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            const now = Date.now();
            if (now - lastTick > 120 || (total > 0 && loaded >= total)) {
              lastTick = now;
              setDownloadLoaded(loaded);
              if (total > 0) setDownloadProgress(Math.min(100, Math.round((loaded / total) * 100)));
            }
          }
        }
        setDownloadLoaded(loaded);
        if (total > 0) setDownloadProgress(100);
        blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/pdf' });
      } else {
        blob = await response.blob();
        setDownloadLoaded(blob.size || total);
        if (total > 0) setDownloadProgress(100);
      }
      const base64 = await blobToBase64(blob);
      // Keep the original extension so Android maps the right MIME type.
      const ext = (ref.file_path.split('.').pop() ?? 'pdf').toLowerCase();
      const fileName = `${ref.id}.${ext}`;
      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: FilesystemDirectory.Data,
        recursive: true,
      });
      const contentType = blob.type || 'application/pdf';
      // Persist per-account so re-entering the section (or restarting
      // the app) shows "فتح" immediately — no re-download.
      saveDownloaded(null, ref.id, {
        uri: writeResult.uri,
        contentType,
        fileName,
        downloadedAt: new Date().toISOString(),
        filePath: ref.file_path,
      });
      setOpenable((prev) => ({ ...prev, [ref.id]: { uri: writeResult.uri, contentType } }));
      showToast('تم التنزيل بنجاح', 'تم حفظ الملف — ستجده جاهزًا للفتح مباشرة في المرات القادمة.', 'success');
    } catch (e) {
      if ((e as Error)?.message === 'CANCELLED') {
        setDownloadFailed(false);
        return;
      }
      console.warn('[references] download failed', e);
      setDownloadFailed(true);
      showToast('تعذّر التنزيل', 'تأكد من الاتصال بالإنترنت وحاول مرة أخرى.', 'error');
    } finally {
      downloadCtlRef.current = null;
      setDownloadingId(null);
      setDownloadPaused(false);
      setDownloadProgress(0);
      setDownloadLoaded(0);
      setDownloadTotal(0);
    }
  };

  const handleOpen = async (ref: ReferenceMaterial) => {
    const op = openable[ref.id];
    if (!op) {
      // No local copy yet — download first, then open in one step.
      await handleDownload(ref);
      // handleDownload already stored the file; re-read openable via a
      // fresh restore-free lookup is unnecessary — just inform the user.
      showToast('تم التنزيل', 'تم حفظ الملف — اضغط "فتح" لقراءة الملف.', 'success');
      return;
    }
    const isNative = (() => {
      try { return Capacitor.isNativePlatform(); } catch { return false; }
    })();
    if (!isNative && webUrlsRef.current[ref.id]) {
      window.open(webUrlsRef.current[ref.id], '_blank');
      return;
    }
    try {
      await FileOpener.open({
        filePath: op.uri,
        contentType: op.contentType,
        openWithDefault: true,
      });
    } catch (e) {
      console.warn('[references] open failed, falling back to browser', e);
      // Fallback: the Capacitor WebView displays PDFs itself. Ask Supabase for
      // a download disposition so Chrome/browser handles it outside the app.
      const publicUrl = supabase.storage.from('references').getPublicUrl(ref.file_path).data.publicUrl;
      const url = `${publicUrl}?download`;
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
      } catch {
        window.open(url, '_blank');
      }
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shadow-md">
            <BookMarked className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">المراجع</h2>
            <p className="text-sm text-slate-500">{references.length} مرجع متاح للتنزيل</p>
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
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="w-5 h-5" />
            إضافة مرجع
          </button>
        )}
      </div>

      {showForm && isDeveloper && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 animate-scale-in"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">عنوان المرجع</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: ملخص الرياضيات"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الوصف (اختياري)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="وصف مختصر للمرجع"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم</label>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedDept('all')}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  selectedDept === 'all'
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
                  onClick={() => setSelectedDept(dept.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    selectedDept === dept.id
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

          {!editingId && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">ملف PDF</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-all">
              {selectedFile ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-700">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setSelectedFile(null); }}
                    className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Upload className="w-7 h-7" />
                  <p className="text-sm">اضغط لاختيار ملف PDF</p>
                </div>
              )}
              <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
            </label>
          </div>
          )}

          {uploadProgress && (
            <div className="flex items-center gap-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg px-4 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting || !title.trim() || (!editingId && !selectedFile)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {editingId ? 'حفظ التعديلات' : 'حفظ المرجع'}
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
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : references.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <BookMarked className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">لا توجد مراجع بعد.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {references.map((ref) => (
            <div
              key={ref.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 transition-all group animate-slide-in hover:shadow-md"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-red-500" />
                </div>
                {isDeveloper && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(ref)}
                      title={ref.__pending ? 'تعديل (لم يُنشر بعد)' : 'تعديل بيانات المرجع'}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-all"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(ref.id, ref.file_path)}
                      title={ref.__pending ? 'إزالة من القائمة المحلية' : 'حذف'}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <h4 className="font-bold text-slate-800 mb-1 line-clamp-2">{ref.title}</h4>
              {ref.__pending && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 mb-2">
                  <CloudUpload className="w-3 h-3" />
                  بانتظار النشر
                </span>
              )}
              {ref.description && (
                <p className="text-sm text-slate-500 mb-3 line-clamp-2">{ref.description}</p>
              )}

              <div className="flex items-center gap-2 flex-wrap mb-4">
                {ref.department && (
                  <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${DEPT_BADGE[ref.department] ?? 'bg-slate-100 text-slate-600'}`}>
                    <DeptIcon dept={ref.department} className="w-3 h-3" />
                    {displayDepartment(ref.department)}
                  </span>
                )}
                {ref.file_size && (
                  <span className="text-[10px] font-medium text-slate-400 px-2 py-0.5 rounded-full bg-slate-100">
                    {formatFileSize(ref.file_size)}
                  </span>
                )}
              </div>

              <button
                onClick={() => (openable[ref.id] ? handleOpen(ref) : handleDownload(ref))}
                disabled={downloadingId === ref.id}
                className={`w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md ${
                  downloadingId === ref.id
                    ? 'bg-indigo-400 text-slate-500 cursor-wait'
                    : openable[ref.id]
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {downloadingId === ref.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : openable[ref.id] ? (
                  <ExternalLink className="w-4 h-4" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {downloadingId === ref.id
                  ? downloadPaused
                    ? 'متوقف مؤقتًا'
                    : downloadTotal > 0
                      ? `جاري التنزيل... ${downloadProgress}%`
                      : 'جاري التنزيل...'
                  : openable[ref.id] ? 'فتح' : downloadFailed && !openable[ref.id] ? 'إعادة المحاولة' : 'تنزيل PDF'}
              </button>
              {downloadingId === ref.id && (
                <div className="mt-2" dir="rtl">
                  <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                    {downloadTotal > 0 ? (
                      <div
                        className={`h-full rounded-full transition-[width] duration-150 ${downloadPaused ? 'bg-amber-500' : 'bg-indigo-600'}`}
                        style={{ width: `${downloadProgress}%` }}
                      />
                    ) : (
                      <div className="h-full w-1/3 rounded-full bg-indigo-500 animate-pulse" />
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>
                      {downloadTotal > 0
                        ? `${formatFileSize(downloadLoaded)} / ${formatFileSize(downloadTotal)}`
                        : `${formatFileSize(downloadLoaded)}`}
                    </span>
                    <span>{downloadTotal > 0 ? `${downloadProgress}%` : '...'}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={toggleDownloadPause}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl transition-all ${
                        downloadPaused
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-amber-500 hover:bg-amber-600 text-white'
                      }`}
                    >
                      {downloadPaused ? (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          استئناف التنزيل
                        </>
                      ) : (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          إيقاف مؤقت
                        </>
                      )}
                    </button>
                    <button
                      onClick={cancelDownload}
                      title="إلغاء التنزيل"
                      className="flex items-center justify-center gap-1 text-xs font-semibold py-2 px-3 rounded-xl bg-red-100 hover:bg-red-200 text-red-600 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      إلغاء
                    </button>
                  </div>
                  {downloadPaused && (
                    <p className="mt-1 text-center text-[11px] font-medium text-amber-600">التنزيل متوقف مؤقتًا</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

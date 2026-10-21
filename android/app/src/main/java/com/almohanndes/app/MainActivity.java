package com.almohanndes.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebStorage;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.security.MessageDigest;

/**
 * Anti-tamper gate:
 * - The release signing-certificate SHA-256 is baked into
 *   BuildConfig.APP_SIGNER_SHA256 at build time (see app/build.gradle).
 * - If this APK was repackaged, decompiled, modified and re-signed with a
 *   DIFFERENT key (the classic "stolen app" scenario), the check fails and
 *   the app closes immediately.
 * - A "debuggable" release build is also refused.
 * - Debug builds pass an empty pin → check skipped, so development is
 *   unaffected.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "AppIntegrity";
    private static final String WATCHDOG_PREFS = "app_first_paint";
    /** مهلة إقلاع سخية: بعدها إن لم تعمل حزمة الويب نُعيد التهيئة. */
    private static final long FIRST_PAINT_TIMEOUT_MS = 15_000L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (!isTamperFree()) {
            finish();
            // Fail closed: terminate the process so a repackaged/debugged
            // release build cannot continue past the gate.
            new Thread(new Runnable() {
                @Override public void run() {
                    try { Thread.sleep(400); } catch (InterruptedException ignored) { }
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(10);
                }
            }).start();
            return;
        }
        // Must run before the bridge creates the WebView (see javadoc below).
        wipeServiceWorkerStorage();
        super.onCreate(savedInstanceState);
        startFirstPaintWatchdog();
    }

    /* =====================================================================
     * حماية من تعطّل التطبيق بسبب Service Worker قديم
     * ---------------------------------------------------------------------
     * الـ WebView يقدّم الملفات من خادم محلي (https://localhost). طلبات
     * الـ Service Worker لا تمرّ على ذلك الخادم، فأي Worker يعترض طلب الصفحة
     * يُفشل تحميل التطبيق بالكامل: "Webpage not available … net::ERR_FAILED".
     * الإصدار 23 سجّل Worker كهذا، فبقيت بعض الأجهزة عالقة على شاشة الخطأ
     * ولا يمكن إصلاحها من داخل الصفحة (الصفحة نفسها لا تُحمّل).
     * لذلك نحذف مخزن الـ Service Worker قبل إنشاء الـ WebView في كل تشغيل:
     *  - localStorage / IndexedDB / الكوكيز لا تُمسّ → لا خروج من الحساب.
     *  - التطبيق نفسه لا يعتمد على أي Worker (الملفات مضمّنة في الـ APK).
     * ===================================================================== */
    private void wipeServiceWorkerStorage() {
        try {
            File filesDir = getFilesDir();
            File dataDir = filesDir != null ? filesDir.getParentFile() : null;
            if (dataDir == null) {
                return;
            }
            String[] profiles = { "app_webview", "app_webview/Default" };
            for (String profile : profiles) {
                File swDir = new File(new File(dataDir, profile), "Service Worker");
                if (swDir.exists()) {
                    Log.i(TAG, "Removing legacy service-worker storage: " + swDir.getAbsolutePath());
                    deleteRecursively(swDir);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "Service-worker cleanup skipped", t);
        }
    }

    private static void deleteRecursively(File file) {
        try {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        } catch (Throwable ignored) {
            // Best effort — a locked file must never crash the app.
        }
    }

    /* =====================================================================
     * حارس الإقلاع: إن لم تُنفَّذ حزمة الويب خلال 15 ثانية (صفحة خطأ أو أصول
     * تالفة) نُعيد تهيئة بيانات الويب مرة واحدة لكل إصدار ثم نُعيد التحميل —
     * مخرج أخير مضمون بدل البقاء على شاشة خطأ للأبد.
     * ===================================================================== */
    private void startFirstPaintWatchdog() {
        final String recoveryKey = "recovered_v" + BuildConfig.VERSION_CODE;
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() {
                try {
                    webViewProbe(getBridge(), recoveryKey);
                } catch (Throwable t) {
                    Log.w(TAG, "First-paint watchdog skipped", t);
                }
            }
        }, FIRST_PAINT_TIMEOUT_MS);
    }

    private void webViewProbe(Bridge bridge, String recoveryKey) {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) {
            return;
        }
        // '1' = الحزمة عملت (العلامة أو شجرة React موجودة)، '0' = لا شيء.
        String probe = "(function(){try{var r=document.getElementById('root');"
            + "if(window.__APP_READY__===true||(r&&r.childElementCount>0)){return '1';}"
            + "return '0';}catch(e){return '0';}})()";
        webView.evaluateJavascript(probe, value -> {
            if (value == null) {
                return; // لا نتيجة موثوقة → لا نلمس بيانات المستخدم
            }
            if (value.contains("1")) {
                return; // إقلاع سليم — لا نتدخل
            }
            SharedPreferences prefs = getSharedPreferences(WATCHDOG_PREFS, MODE_PRIVATE);
            if (prefs.getBoolean(recoveryKey, false)) {
                return; // محاولة واحدة لكل إصدار — لا حلقات إعادة تحميل
            }
            prefs.edit().putBoolean(recoveryKey, true).apply();
            Log.w(TAG, "WebView never painted — resetting web data and reloading once");
            recoverWebView(webView, bridge);
        });
    }

    private void recoverWebView(WebView webView, Bridge bridge) {
        try {
            WebStorage.getInstance().deleteAllData();
        } catch (Throwable ignored) {
            // ignore
        }
        wipeServiceWorkerStorage();
        try {
            webView.clearCache(true);
        } catch (Throwable ignored) {
            // ignore
        }
        String url = "https://localhost";
        try {
            if (bridge != null && bridge.getServerUrl() != null) {
                url = bridge.getServerUrl();
            }
        } catch (Throwable ignored) {
            // keep the default origin
        }
        try {
            webView.loadUrl(url);
        } catch (Throwable t) {
            Log.w(TAG, "Recovery reload failed", t);
        }
    }

    private boolean isTamperFree() {
        final String expected = BuildConfig.APP_SIGNER_SHA256;
        // No pin baked in (debug build / machine without keystore) → allow.
        if (expected == null || expected.isEmpty()) {
            return true;
        }
        // A release build must never run with the debuggable flag.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return false;
        }
        // Refuse dynamic debugging/tracing of a signed release build.
        if (android.os.Debug.isDebuggerConnected() || android.os.Debug.waitingForDebugger()) {
            return false;
        }
        Signature[] signatures = currentSignatures();
        if (signatures == null || signatures.length == 0) {
            return false; // could not verify → fail closed
        }
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (Signature signature : signatures) {
                md.reset();
                StringBuilder sb = new StringBuilder();
                for (byte b : md.digest(signature.toByteArray())) {
                    sb.append(String.format("%02x", b & 0xff));
                }
                if (expected.equalsIgnoreCase(sb.toString())) {
                    return true;
                }
            }
            Log.e(TAG, "Signing certificate mismatch — repackaged APK");
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Integrity check error", e);
            return false;
        }
    }

    /** Current signer certificate(s) of the installed package (all API levels). */
    private Signature[] currentSignatures() {
        try {
            PackageManager pm = getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (info.signingInfo == null) return null;
                return info.signingInfo.getApkContentsSigners();
            }
            PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
            return info.signatures;
        } catch (Exception e) {
            Log.e(TAG, "Cannot read package signatures", e);
            return null;
        }
    }
}

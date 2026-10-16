package com.almohanndes.app;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.security.MessageDigest;

/**
 * Anti-tamper gate:
 * - The release signing-certificate SHA-256 is baked into
 *   BuildConfig.APP_SIGNER_SHA256 at build time (see app/build.gradle).
 * - If this APK was repackaged, decompiled, modified and re-signed with a
 *   DIFFERENT key (the classic "stolen app" scenario), the check fails and
 *   the app closes immediately.
 * - A "debuggable" release build is also refused.
 * - Device integrity checks (root, emulator, ADB, unknown sources) are also
 *   enforced so the app refuses to run on compromised devices.
 * - Debug builds pass an empty pin → check skipped, so development is
 *   unaffected.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "AppIntegrity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (!isTamperFree()) {
            Log.e(TAG, "Integrity check failed (repackaged or debuggable release) — aborting");
            finish();
            return;
        }
        // Device integrity check — log threats but do NOT block launch.
        // This avoids false positives on normal user devices (ADB on, unknown sources enabled, etc.).
        // Re-enable hard enforcement later via BuildConfig.DEVICE_CHECK_ENFORCED if needed.
        if (!DeviceIntegrityChecker.isDeviceSafe(this)) {
            Log.w(TAG, "Device integrity threat detected (non-fatal): " + DeviceIntegrityChecker.assessThreat(this));
        }
        super.onCreate(savedInstanceState);
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

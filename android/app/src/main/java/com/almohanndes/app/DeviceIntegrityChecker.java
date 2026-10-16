package com.almohanndes.app;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;

/**
 * Device integrity checks to harden the app against tampering / theft.
 * All checks are fail-safe: if anything looks suspicious, the app should refuse to run.
 */
public class DeviceIntegrityChecker {
    private static final String TAG = "DeviceIntegrity";

    public enum Threat {
        NONE,
        ROOTED,
        EMULATOR,
        DEBUGGABLE,
        ADB_ENABLED,
        UNKNOWN_SOURCES,
        MULTIPLE
    }

    /**
     * Returns true if the device appears clean enough to run the app.
     * Logs the detected threat(s) for debugging.
     */
    public static boolean isDeviceSafe(Context context) {
        Threat threat = assessThreat(context);
        if (threat == Threat.NONE) {
            return true;
        }
        Log.w(TAG, "Device integrity threat detected: " + threat);
        return false;
    }

    public static Threat assessThreat(Context context) {
        boolean rooted = isRooted();
        boolean emulator = isEmulator();
        boolean debuggable = isDebuggable(context);
        boolean adb = isAdbEnabled(context);
        boolean unknownSources = isUnknownSourcesEnabled(context);

        int count = 0;
        if (rooted) count++;
        if (emulator) count++;
        if (debuggable) count++;
        if (adb) count++;
        if (unknownSources) count++;

        if (count == 0) return Threat.NONE;
        if (count >= 2) return Threat.MULTIPLE;
        if (rooted) return Threat.ROOTED;
        if (emulator) return Threat.EMULATOR;
        if (debuggable) return Threat.DEBUGGABLE;
        if (adb) return Threat.ADB_ENABLED;
        return Threat.UNKNOWN_SOURCES;
    }

    /* ---------- Root detection ---------- */
    private static boolean isRooted() {
        // Check common root management apps / binaries
        String[] rootPaths = {
                "/system/app/Superuser.apk",
                "/system/bin/su",
                "/system/xbin/su",
                "/sbin/su",
                "/bin/su",
                "/system/su",
                "/system/bin/failsafe/su",
                "/data/local/su",
                "/data/local/bin/su",
                "/data/local/xbin/su",
                "/su/bin/su"
        };
        for (String path : rootPaths) {
            if (new File(path).exists()) {
                return true;
            }
        }

        // Check build tags for test-keys
        String buildTags = Build.TAGS;
        if (buildTags != null && buildTags.contains("test-keys")) {
            return true;
        }

        // Try runtime exec "which su"
        try {
            Process process = Runtime.getRuntime().exec(new String[]{"/system/xbin/which", "su"});
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains("su")) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            // not root or command missing
        }

        return false;
    }

    /* ---------- Emulator detection ---------- */
    private static boolean isEmulator() {
        return Build.FINGERPRINT.contains("generic")
                || Build.FINGERPRINT.contains("unknown")
                || Build.HARDWARE.contains("goldfish")
                || Build.HARDWARE.contains("ranchu")
                || Build.MODEL.contains("google_sdk")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK")
                || Build.PRODUCT.contains("sdk")
                || Build.PRODUCT.contains("google_sdk")
                || Build.BOARD.contains("goldfish")
                || Build.BRAND.contains("generic")
                || Build.DEVICE.contains("generic")
                || Build.BOOTLOADER.contains("unknown");
    }

    /* ---------- Debuggable flag ---------- */
    private static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /* ---------- ADB enabled ---------- */
    private static boolean isAdbEnabled(Context context) {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.ADB_ENABLED, 0) == 1;
        } catch (Exception e) {
            return false;
        }
    }

    /* ---------- Unknown sources (install from unknown apps) ---------- */
    private static boolean isUnknownSourcesEnabled(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return context.getPackageManager().canRequestPackageInstalls();
            } else {
                return Settings.Secure.getInt(context.getContentResolver(), Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1;
            }
        } catch (Exception e) {
            return false;
        }
    }
}

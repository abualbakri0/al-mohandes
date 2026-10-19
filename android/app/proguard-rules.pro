# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ============================================================
# Capacitor core protection rules
# ============================================================

# Keep Capacitor plugin annotations and bridge classes
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }

# Keep native methods (JNI)
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep classes with @JavascriptInterface annotation (WebView bridge)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Capacitor Bridge / MessageHandler / PluginCall runtime reflection targets
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.JSExport { *; }

# Keep Cordova plugin classes (from capacitor-cordova-android-plugins)
-keep class org.apache.cordova.** { *; }

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# Keep enums (used by Capacitor config)
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Keep JavaScript interface used by the app if any
-keepclassmembers class com.almohanndes.app.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Obfuscation: rename source file and keep line info for readable crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ============================================================
# Harder-to-reverse obfuscation (release only)
# ============================================================
# Move all classes into a single flat package so package structure leaks nothing
-repackageclasses ''
# Allow method/field visibility changes → more aggressive optimization
-allowaccessmodification



# ============================================================
# Release hardening (in-place): strip logs + aggressive overload
# ============================================================
-assumenosideeffects class android.util.Log { public static *** d(...); public static *** v(...); public static *** i(...); public static *** w(...); public static *** e(...); }
-assumenosideeffects class java.io.PrintStream { public void println(...); }
-overloadaggressively
-keep class com.almohanndes.app.MainActivity { *; }
-keep class com.almohanndes.app.BuildConfig { *; }

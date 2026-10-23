# ============================================================================
#  R8 / ProGuard — تشويش وتقليص كود أندرويد الأصلي (release)
# ============================================================================
# ملاحظة مهمة: هذا الملف يحمي **كود Java/Kotlin** فقط. حزمة الويب (JS) داخل
# assets/public لا يمسّها R8 — تشويشها يتم في Vite (build/vite-plugin-obfuscator.ts).
#
# الملفات المرجعية من Gradle (تُولَّد تلقائياً، لا تُحرَّر):
#   app/build/generated/r8-rules/capacitor-plugins-keep.pro
#   (مُشتقّة من assets/capacitor.plugins.json — تمنع R8 من إعادة تسمية أي
#    بلجن يُنشأ بالانعكاس عبر Class.forName)
# ============================================================================

# --- سمات عامة يجب إبقاؤها ------------------------------------------------
# Annotations/Signature/InnerClasses: تعتمد عليها مكتبات الانعكاس (Firebase,
# Gson, AndroidX). حذفها يسبب أعطالاً وقت التشغيل لا وقت البناء.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepattributes SourceFile,LineNumberTable
# إخفاء اسم ملف المصدر في آثار الأعطال (يبقى السطر فقط).
-renamesourcefileattribute SourceFile

# --- Capacitor ------------------------------------------------------------
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.JSExport { *; }
# الجسر يستدعي @PluginMethod/@JavascriptInterface بالاسم نصياً.
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# بلجنات Cordova (حزمة capacitor-cordova-android-plugins)
-keep class org.apache.cordova.** { *; }

# --- Firebase / FCM (الإشعارات) -------------------------------------------
# خدمات FCM تُنشئ خدمتك بالانعكاس من البيان، وتستدعي onNewToken/onMessageReceived
# بالاسم. تقليصها = إشعارات صامتة بلا أي خطأ بناء.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keep class * extends com.google.firebase.messaging.FirebaseMessagingService { *; }
-keep class * extends com.google.firebase.messaging.FirebaseMessagingReceiver { *; }
-keepclassmembers class * extends com.google.firebase.messaging.FirebaseMessagingService {
    public void onNewToken(java.lang.String);
    public void onMessageReceived(com.google.firebase.messaging.RemoteMessage);
}
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# --- JNI / Parcelable / Enums --------------------------------------------
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * {
    @androidx.annotation.Keep <methods>;
}
-keepclassmembers class * {
    @androidx.annotation.Keep <fields>;
}

# --- تطبيقنا --------------------------------------------------------------
# MainActivity يُنشأ من البيان بالاسم؛ BuildConfig يحمل بصمة التوقيع المرجعية.
-keep class com.almohanndes.app.MainActivity { *; }
-keep class com.almohanndes.app.BuildConfig { *; }

# --- تنظيف السجلات --------------------------------------------------------
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}
-assumenosideeffects class java.io.PrintStream {
    public void println(...);
}

# --- تشويش أقوى ----------------------------------------------------------
# ضمّ كل الأصناف في حزمة جذر واحدة ⇒ بنية الحزم لا تكشف شيئاً.
-repackageclasses ''
-allowaccessmodification
-overloadaggressively

# --- عدم إفشال البناء على مراجع اختيارية غائبة ---------------------------
-dontwarn javax.annotation.**
-dontwarn javax.lang.model.element.**
-dontwarn org.jetbrains.annotations.**
-dontwarn kotlin.Metadata
-dontwarn kotlin.jvm.internal.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.google.j2objc.annotations.**
-dontwarn org.jspecify.annotations.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
-dontwarn sun.misc.**


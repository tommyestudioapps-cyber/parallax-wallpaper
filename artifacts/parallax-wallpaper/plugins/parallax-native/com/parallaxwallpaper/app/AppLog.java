package com.parallaxwallpaper.app;

import android.util.Log;

final class AppLog {
  // TEMPORÁRIO — diagnóstico. Reverter após o bug ser corrigido.
  private static final boolean FORCE_LOGGING = true;
  private static final String TAG = "ParallaxWallpaper";

  private AppLog() {}

  static void d(String message) {
    if (FORCE_LOGGING || BuildConfig.DEBUG) Log.d(TAG, message);
  }

  static void i(String message) {
    if (FORCE_LOGGING || BuildConfig.DEBUG) Log.i(TAG, message);
  }

  static void w(String message) {
    if (FORCE_LOGGING || BuildConfig.DEBUG) Log.w(TAG, message);
  }

  static void e(String message) {
    Log.e(TAG, message);
  }

  static void e(String message, Throwable error) {
    Log.e(TAG, message, error);
  }
}
package com.parallaxwallpaper.app;

import android.view.SurfaceHolder;

public interface WallpaperRenderer {
  void onSurfaceCreated(SurfaceHolder holder);

  void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height);

  void onSurfaceDestroyed(SurfaceHolder holder);

  void updateSensorState(ParallaxSensorState sensorState);

  void setVisible(boolean visible);

  void renderFrame();

  void release();

  void setForceDraw(boolean force);

  void invalidateComposition();

  void onTrimMemory(int level);

  float getIntensity();
}
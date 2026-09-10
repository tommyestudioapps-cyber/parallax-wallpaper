package com.parallaxwallpaper.app;

import android.content.Context;
import android.content.res.Configuration;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Display;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.WindowManager;
import java.util.concurrent.atomic.AtomicLong;

public class ParallaxWallpaperService extends WallpaperService {
  private static final String TAG = "ParallaxWallpaper";
  static final String PREFS_NAME = "parallax_wallpaper";
  static final String PREF_RENDERER_TYPE = "renderer_type";
  static final String RENDERER_OPENGL = "OPENGL";
  static final String RENDERER_CANVAS = "CANVAS";
  private static final String DEFAULT_RENDERER_TYPE = RENDERER_OPENGL;
  private static volatile ParallaxEngine activeEngine;

  @Override
  public Engine onCreateEngine() {
    ParallaxEngine engine = new ParallaxEngine();
    activeEngine = engine;
    return engine;
  }

  static void requestRendererType(String rendererType) {
    ParallaxEngine engine = activeEngine;
    if (engine != null) engine.requestRendererType(rendererType);
  }

  static void notifyCompositionChanged() {
    ParallaxEngine engine = activeEngine;
    if (engine != null) engine.onCompositionChangedExternally();
  }

  static String normalizeRendererType(String rendererType) {
    return RENDERER_CANVAS.equals(rendererType) ? RENDERER_CANVAS : RENDERER_OPENGL;
  }

  private String getConfiguredRendererType() {
    return normalizeRendererType(
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(PREF_RENDERER_TYPE, DEFAULT_RENDERER_TYPE));
  }

  @Override
  public void onTrimMemory(int level) {
    super.onTrimMemory(level);
    ParallaxEngine engine = activeEngine;
    if (engine != null) engine.onTrimMemory(level);
  }

  @Override
  public void onConfigurationChanged(Configuration newConfig) {
    super.onConfigurationChanged(newConfig);
    ParallaxEngine engine = activeEngine;
    if (engine != null) engine.onConfigurationChanged();
  }

  private class ParallaxEngine extends Engine implements SensorEventListener {
    private static final float MOTION_DEAD_ZONE = 0.12f;

    private final SensorManager sensorManager;
    private final Sensor rotationSensor;
    private final HandlerThread renderThread;
    private final Handler renderHandler;
    private final Object frameLock = new Object();
    private final Object motionLock = new Object();
    private final AtomicLong totalSensorEvents = new AtomicLong();
    private final AtomicLong skippedSensorFrames = new AtomicLong();
    private final AtomicLong requestedFrames = new AtomicLong();
    private volatile WallpaperRenderer renderer;
    private volatile String rendererType;

    private volatile boolean visible;
    private volatile boolean destroyed;
    private volatile SurfaceHolder surfaceHolder;
    private volatile int surfaceWidth;
    private volatile int surfaceHeight;
    private boolean frameQueued;
    private boolean redrawRequested;
    private boolean forceDrawRequested;
    private boolean sensorRegistered;
    private boolean calibrated;
    private float baselinePitch;
    private float baselineRoll;
    private float pitchSum;
    private float rollSum;
    private int calibrationSamples;
    private volatile ParallaxSensorState motionSnapshot = ParallaxSensorState.ZERO;
    private float filteredMotionX;
    private float filteredMotionY;
    private long lastTimestamp;

    private int cachedRotation = Surface.ROTATION_0;
    private int cachedAxisX = SensorManager.AXIS_X;
    private int cachedAxisY = SensorManager.AXIS_Y;

    private final float[] rotationMatrix = new float[9];
    private final float[] remappedMatrix = new float[9];
    private final float[] orientation = new float[3];

    private final Runnable renderRunnable = new Runnable() {
      @Override
      public void run() {
        boolean force;
        synchronized (frameLock) {
          redrawRequested = false;
          force = forceDrawRequested;
          forceDrawRequested = false;
        }

        WallpaperRenderer currentRenderer = renderer;
        if (currentRenderer != null) {
          currentRenderer.setForceDraw(force);
          currentRenderer.renderFrame();
        }

        boolean renderAgain;
        synchronized (frameLock) {
          renderAgain = redrawRequested && !destroyed;
          if (!renderAgain) frameQueued = false;
        }
        if (renderAgain) renderHandler.post(this);
      }
    };

    ParallaxEngine() {
      sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
      rotationSensor = sensorManager == null
          ? null
          : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
      renderThread = new HandlerThread("ParallaxWallpaperRenderer");
      renderThread.start();
      renderHandler = new Handler(renderThread.getLooper());
      refreshCachedRotation();
      rendererType = getConfiguredRendererType();
      renderer = createRenderer(rendererType);
      Log.i(TAG, "PARALLAX_ENGINE_CREATED");
      requestFrame(true);
    }

    @Override
    public void onVisibilityChanged(boolean isVisible) {
      visible = isVisible;
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) currentRenderer.setVisible(isVisible);
      Log.i(TAG, "PARALLAX_VISIBILITY_CHANGED visible=" + isVisible);
      if (isVisible) {
        if (currentRenderer != null) currentRenderer.invalidateComposition();
        calibrated = false;
        calibrationSamples = 0;
        pitchSum = 0;
        rollSum = 0;
        synchronized (motionLock) {
          filteredMotionX = 0f;
          filteredMotionY = 0f;
          motionSnapshot = ParallaxSensorState.ZERO;
          if (currentRenderer != null) currentRenderer.updateSensorState(motionSnapshot);
        }
        lastTimestamp = 0;
        refreshCachedRotation();
        registerSensor();
        requestFrame(true);
      } else {
        unregisterSensor();
      }
    }

    @Override
    public void onSurfaceCreated(SurfaceHolder holder) {
      super.onSurfaceCreated(holder);
      surfaceHolder = holder;
      surfaceWidth = holder.getSurfaceFrame().width();
      surfaceHeight = holder.getSurfaceFrame().height();
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) currentRenderer.onSurfaceCreated(holder);
      Log.i(TAG, "PARALLAX_SURFACE_CREATED valid=" + holder.getSurface().isValid());
      if (visible) registerSensor();
      requestFrame(true);
    }

    @Override
    public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
      super.onSurfaceChanged(holder, format, width, height);
      surfaceHolder = holder;
      surfaceWidth = width;
      surfaceHeight = height;
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) currentRenderer.onSurfaceChanged(holder, format, width, height);
      Log.i(TAG, "PARALLAX_SURFACE_CHANGED width=" + width + " height=" + height + " valid=" + holder.getSurface().isValid());
      requestFrame(true);
    }

    @Override
    public void onSurfaceDestroyed(SurfaceHolder holder) {
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) currentRenderer.onSurfaceDestroyed(holder);
      if (surfaceHolder == holder) {
        surfaceHolder = null;
        surfaceWidth = 0;
        surfaceHeight = 0;
      }
      unregisterSensor();
      Log.i(TAG, "PARALLAX_SURFACE_DESTROYED");
      super.onSurfaceDestroyed(holder);
    }

    @Override
    public void onDestroy() {
      destroyed = true;
      if (activeEngine == this) activeEngine = null;
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) currentRenderer.setVisible(false);
      unregisterSensor();
      renderHandler.removeCallbacksAndMessages(null);
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          WallpaperRenderer rendererToRelease = renderer;
          if (rendererToRelease != null) rendererToRelease.release();
          renderThread.quitSafely();
        }
      });
      Log.i(TAG, "PARALLAX_ENGINE_DESTROYED");
      super.onDestroy();
    }

    void onConfigurationChanged() {
      boolean rotationChanged = refreshCachedRotation();
      if (rotationChanged) {
        invalidateSensorCalibration();
        Log.i(TAG, "PARALLAX_SENSOR_CALIBRATION_INVALIDATED reason=rotation_changed");
      }
    }

    void onCompositionChangedExternally() {
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          if (destroyed) return;
          WallpaperRenderer currentRenderer = renderer;
          if (currentRenderer != null) currentRenderer.invalidateComposition();
          Log.i(TAG, "PARALLAX_COMPOSITION_INVALIDATED_EXTERNAL");
          requestFrame(true);
        }
      });
    }

    void onTrimMemory(final int level) {
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          if (destroyed) return;
          WallpaperRenderer currentRenderer = renderer;
          if (currentRenderer != null) {
            currentRenderer.onTrimMemory(level);
            requestFrame(true);
          }
        }
      });
    }

    private boolean refreshCachedRotation() {
      WindowManager windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
      Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
      int rotation = display == null ? Surface.ROTATION_0 : display.getRotation();
      int axisX = SensorManager.AXIS_X;
      int axisY = SensorManager.AXIS_Y;
      switch (rotation) {
        case Surface.ROTATION_90:
          axisX = SensorManager.AXIS_Y;
          axisY = SensorManager.AXIS_MINUS_X;
          break;
        case Surface.ROTATION_180:
          axisX = SensorManager.AXIS_MINUS_X;
          axisY = SensorManager.AXIS_MINUS_Y;
          break;
        case Surface.ROTATION_270:
          axisX = SensorManager.AXIS_MINUS_Y;
          axisY = SensorManager.AXIS_X;
          break;
        default:
          break;
      }
      boolean rotationChanged = rotation != cachedRotation;
      cachedRotation = rotation;
      cachedAxisX = axisX;
      cachedAxisY = axisY;
      return rotationChanged;
    }

    private void invalidateSensorCalibration() {
      calibrated = false;
      calibrationSamples = 0;
      pitchSum = 0f;
      rollSum = 0f;
      lastTimestamp = 0;
    }

    private void registerSensor() {
      if (!sensorRegistered && sensorManager != null && rotationSensor != null) {
        sensorManager.registerListener(this, rotationSensor, 33000);
        sensorRegistered = true;
        Log.i(TAG, "PARALLAX_SENSOR_REGISTERED");
      }
    }

    private void unregisterSensor() {
      if (sensorRegistered && sensorManager != null) {
        sensorManager.unregisterListener(this);
        sensorRegistered = false;
        Log.i(TAG, "PARALLAX_SENSOR_UNREGISTERED");
      }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
      totalSensorEvents.incrementAndGet();
      if (!visible || event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) return;
      SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
      SensorManager.remapCoordinateSystem(
          rotationMatrix,
          cachedAxisX,
          cachedAxisY,
          remappedMatrix);
      SensorManager.getOrientation(remappedMatrix, orientation);
      float pitch = orientation[1];
      float roll = orientation[2];

      if (!calibrated) {
        pitchSum += pitch;
        rollSum += roll;
        calibrationSamples += 1;
        if (calibrationSamples >= 12) {
          baselinePitch = pitchSum / calibrationSamples;
          baselineRoll = rollSum / calibrationSamples;
          calibrated = true;
          Log.i(TAG, "PARALLAX_SENSOR_CALIBRATED");
        }
        lastTimestamp = event.timestamp;
        return;
      }

      float dt = lastTimestamp == 0
          ? 1f / 60f
          : Math.max(
              0.004f,
              Math.min(0.25f, (event.timestamp - lastTimestamp) / 1000000000f));
      lastTimestamp = event.timestamp;
      WallpaperRenderer currentRenderer = renderer;
      float intensity = currentRenderer == null ? 1f : currentRenderer.getIntensity();
      float targetX = softLimit(
          (float) Math.toDegrees(shortestAngleDelta(roll, baselineRoll))
              * 0.45f
              * intensity,
          18f);
      float targetY = softLimit(
          (float) Math.toDegrees(shortestAngleDelta(pitch, baselinePitch))
              * 0.4f
              * intensity,
          15f);
      float filter = 1f - (float) Math.exp(-10f * dt);
      float processedMotionX;
      float processedMotionY;
      boolean publishMotion;
      ParallaxSensorState nextSensorState = null;
      synchronized (motionLock) {
        filteredMotionX += (targetX - filteredMotionX) * filter;
        filteredMotionY += (targetY - filteredMotionY) * filter;
        processedMotionX = filteredMotionX;
        processedMotionY = filteredMotionY;

        ParallaxSensorState publishedSnapshot = motionSnapshot;
        publishMotion =
            Math.abs(processedMotionX - publishedSnapshot.getX()) >= MOTION_DEAD_ZONE
                || Math.abs(processedMotionY - publishedSnapshot.getY()) >= MOTION_DEAD_ZONE;
        if (publishMotion) {
          nextSensorState = new ParallaxSensorState(processedMotionX, processedMotionY);
          motionSnapshot = nextSensorState;
          if (currentRenderer != null) {
            currentRenderer.updateSensorState(nextSensorState);
          }
        } else {
          skippedSensorFrames.incrementAndGet();
        }
      }
      if (!publishMotion) return;
      requestFrame(false);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private float shortestAngleDelta(float current, float baseline) {
      float delta = current - baseline;
      while (delta > Math.PI) delta -= (float) (Math.PI * 2);
      while (delta < -Math.PI) delta += (float) (Math.PI * 2);
      return delta;
    }

    private float softLimit(float value, float limit) {
      return limit * (float) Math.tanh(value / limit);
    }

    private void requestFrame(boolean force) {
      if (destroyed) return;
      requestedFrames.incrementAndGet();
      synchronized (frameLock) {
        redrawRequested = true;
        forceDrawRequested = forceDrawRequested || force;
        if (frameQueued) return;
        frameQueued = true;
      }
      renderHandler.post(renderRunnable);
    }

    private WallpaperRenderer createRenderer(String type) {
      if (RENDERER_CANVAS.equals(type)) {
        return new CanvasWallpaperRenderer(
            ParallaxWallpaperService.this,
            totalSensorEvents,
            skippedSensorFrames,
            requestedFrames);
      }
      return new ParallaxEglController(
          ParallaxWallpaperService.this,
          new ParallaxEglController.FailureListener() {
            @Override
            public void onGpuFailure(ParallaxEglController controller, String reason) {
              onGpuFailureForEngine(controller, reason);
            }
          });
    }

    private void requestRendererType(String requestedType) {
      final String nextType = normalizeRendererType(requestedType);
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          switchRenderer(nextType, "user_selection");
        }
      });
    }

    private void onGpuFailureForEngine(
        final ParallaxEglController failedController,
        final String reason) {
      Log.e(TAG, "PARALLAX_RENDERER_FALLBACK reason=" + reason);
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          if (renderer == failedController && !destroyed) {
            switchRenderer(RENDERER_CANVAS, reason);
          }
        }
      });
    }

    private void switchRenderer(String nextType, String reason) {
      if (destroyed || nextType.equals(rendererType)) return;
      WallpaperRenderer previousRenderer = renderer;
      rendererType = nextType;
      if (previousRenderer != null) {
        previousRenderer.setVisible(false);
        previousRenderer.release();
      }

      WallpaperRenderer nextRenderer = createRenderer(nextType);
      renderer = nextRenderer;
      nextRenderer.updateSensorState(motionSnapshot);
      nextRenderer.setVisible(visible);
      if (surfaceHolder != null && surfaceHolder.getSurface() != null
          && surfaceHolder.getSurface().isValid()) {
        nextRenderer.onSurfaceCreated(surfaceHolder);
        if (surfaceWidth > 0 && surfaceHeight > 0) {
          nextRenderer.onSurfaceChanged(
              surfaceHolder,
              0,
              surfaceWidth,
              surfaceHeight);
        }
      }
      Log.i(TAG, "PARALLAX_RENDERER_SELECTED type=" + nextType + " reason=" + reason);
      requestFrame(true);
    }
  }
}
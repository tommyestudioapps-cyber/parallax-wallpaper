package com.parallaxwallpaper.app;

import android.content.Context;
import android.content.res.Configuration;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Display;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.WindowManager;

public class ParallaxWallpaperService extends WallpaperService {
  private static final String TAG = "ParallaxWallpaper";
  static final String PREFS_NAME = "parallax_wallpaper";
  private static volatile ParallaxEngine activeEngine;

  @Override
  public Engine onCreateEngine() {
    ParallaxEngine engine = new ParallaxEngine();
    activeEngine = engine;
    return engine;
  }

  static void notifyCompositionChanged() {
    ParallaxEngine engine = activeEngine;
    if (engine != null) engine.onCompositionChangedExternally();
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
    private final Object motionLock = new Object();
    private volatile WallpaperRenderer renderer;

    private volatile boolean visible;
    private volatile boolean destroyed;
    private volatile SurfaceHolder surfaceHolder;
    private volatile int surfaceWidth;
    private volatile int surfaceHeight;
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

    ParallaxEngine() {
      sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
      rotationSensor = sensorManager == null
          ? null
          : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
      refreshCachedRotation();
      renderer = createRenderer();
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
      if (currentRenderer != null) {
        currentRenderer.setVisible(false);
        currentRenderer.release();
      }
      unregisterSensor();
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
      if (destroyed) return;
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) {
        currentRenderer.invalidateComposition();
        Log.i(TAG, "PARALLAX_COMPOSITION_INVALIDATED_EXTERNAL");
        requestFrame(true);
      }
    }

    void onTrimMemory(final int level) {
      if (destroyed) return;
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) {
        currentRenderer.onTrimMemory(level);
        requestFrame(true);
      }
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
      WallpaperRenderer currentRenderer = renderer;
      if (currentRenderer != null) {
        currentRenderer.setForceDraw(force);
        currentRenderer.renderFrame();
      }
    }

    private WallpaperRenderer createRenderer() {
      return new ParallaxEglController(
          ParallaxWallpaperService.this,
          new ParallaxEglController.FailureListener() {
            @Override
            public void onGpuFailure(ParallaxEglController controller, String reason) {
              Log.e(TAG, "PARALLAX_GPU_FAILURE reason=" + reason);
            }
          });
    }
  }
}
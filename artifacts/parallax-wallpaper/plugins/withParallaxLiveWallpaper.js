const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'com.parallaxwallpaper.app';
const JAVA_PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, '/');

function withParallaxWallpaperManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('Parallax wallpaper plugin could not find the Android application node.');
    }

    application.service = application.service || [];
    const alreadyRegistered = application.service.some(
      (service) => service.$?.['android:name'] === '.ParallaxWallpaperService',
    );

    if (!alreadyRegistered) {
      application.service.push({
        $: {
          'android:name': '.ParallaxWallpaperService',
          'android:label': 'Parallax Wallpaper',
          'android:permission': 'android.permission.BIND_WALLPAPER',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.wallpaper.WallpaperService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.service.wallpaper',
              'android:resource': '@xml/parallax_wallpaper',
            },
          },
        ],
      });
    }

    return modConfig;
  });
}

function withParallaxWallpaperMainApplication(config) {
  return withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('ParallaxWallpaperPackage')) {
      contents = contents.replace(
        /^(package [^\n]+\n)/m,
        `$1\nimport ${PACKAGE_NAME}.ParallaxWallpaperPackage\n`,
      );
    }

    if (contents.includes('add(ParallaxWallpaperPackage())')) {
      // The generated native project already contains the package registration.
    } else if (contents.includes('PackageList(this).packages.apply {')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(ParallaxWallpaperPackage())\n',
      );
    } else if (contents.includes('PackageList(this).packages')) {
      contents = contents.replace(
        'val packages = PackageList(this).packages',
        'val packages = PackageList(this).packages\n    packages.add(ParallaxWallpaperPackage())',
      );
    } else if (contents.includes('PackageList(this).getPackages()')) {
      contents = contents.replace(
        'List<ReactPackage> packages = new PackageList(this).getPackages();',
        'List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ParallaxWallpaperPackage());',
      );
    } else {
      throw new Error('Parallax wallpaper plugin could not find the React Native package list.');
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

function withParallaxWallpaperFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const androidRoot = path.join(modConfig.modRequest.platformProjectRoot);
      const javaDirectory = path.join(androidRoot, 'app', 'src', 'main', 'java', JAVA_PACKAGE_PATH);
      const xmlDirectory = path.join(androidRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(javaDirectory, { recursive: true });
      fs.mkdirSync(xmlDirectory, { recursive: true });

      fs.writeFileSync(path.join(javaDirectory, 'ParallaxWallpaperPackage.java'), PARALLAX_PACKAGE_JAVA);
      fs.writeFileSync(path.join(javaDirectory, 'ParallaxWallpaperModule.java'), PARALLAX_MODULE_JAVA);
      fs.writeFileSync(path.join(javaDirectory, 'ParallaxWallpaperService.java'), PARALLAX_SERVICE_JAVA);
      fs.writeFileSync(path.join(xmlDirectory, 'parallax_wallpaper.xml'), PARALLAX_XML);
      return modConfig;
    },
  ]);
}

const PARALLAX_PACKAGE_JAVA = `package ${PACKAGE_NAME};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ParallaxWallpaperPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new ParallaxWallpaperModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;

const PARALLAX_MODULE_JAVA = `package ${PACKAGE_NAME};

import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class ParallaxWallpaperModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  public ParallaxWallpaperModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "ParallaxWallpaper";
  }

  @ReactMethod
  public void configureLiveWallpaper(String configJson, Promise promise) {
    try {
      reactContext
          .getSharedPreferences("parallax_wallpaper", Context.MODE_PRIVATE)
          .edit()
          .putString("composition", configJson)
          .apply();
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("CONFIGURE_WALLPAPER_FAILED", error);
    }
  }

  @ReactMethod
  public void openLiveWallpaperChooser(Promise promise) {
    try {
      Intent intent = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
      intent.putExtra(
          WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
          new ComponentName(reactContext, ParallaxWallpaperService.class)
      );
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("OPEN_WALLPAPER_CHOOSER_FAILED", error);
    }
  }
}
`;

const PARALLAX_SERVICE_JAVA = `package ${PACKAGE_NAME};

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.SurfaceHolder;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.content.Context;
import android.view.Display;
import android.view.Surface;
import android.view.WindowManager;
import java.io.InputStream;
import org.json.JSONObject;

public class ParallaxWallpaperService extends WallpaperService {
  private static final String TAG = "ParallaxWallpaper";

  @Override
  public Engine onCreateEngine() {
    return new ParallaxEngine();
  }

  private class ParallaxEngine extends Engine implements SensorEventListener {
    private static final long DIAGNOSTIC_LOG_INTERVAL_MS = 2000L;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final SensorManager sensorManager;
    private final Sensor rotationSensor;
    private final HandlerThread renderThread;
    private final Handler renderHandler;
    private final Object frameLock = new Object();
    private final Bitmap[] bitmaps = new Bitmap[3];
    private final float[] rotationMatrix = new float[9];
    private final float[] remappedMatrix = new float[9];
    private final float[] orientation = new float[3];
    private volatile JSONObject composition;
    private volatile float intensity = 1f;
    private volatile boolean visible;
    private volatile boolean surfaceReady;
    private volatile boolean destroyed;
    private volatile boolean reloadCompositionRequested = true;
    private boolean frameQueued;
    private boolean redrawRequested;
    private boolean forceDrawRequested;
    private boolean sensorRegistered;
    private boolean firstFrameDrawn;
    private String compositionJson;
    private boolean calibrated;
    private float baselinePitch;
    private float baselineRoll;
    private float pitchSum;
    private float rollSum;
    private int calibrationSamples;
    private volatile float motionX;
    private volatile float motionY;
    private long lastTimestamp;
    private long lastFrameLogAt;
    private long lastSensorLogAt;

    private final Runnable renderRunnable = new Runnable() {
      @Override
      public void run() {
        boolean force;
        synchronized (frameLock) {
          redrawRequested = false;
          force = forceDrawRequested;
          forceDrawRequested = false;
        }

        drawFrame(force);

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
      rotationSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
      renderThread = new HandlerThread("ParallaxWallpaperRenderer");
      renderThread.start();
      renderHandler = new Handler(renderThread.getLooper());
      Log.i(TAG, "PARALLAX_ENGINE_CREATED");
      requestFrame(true);
    }

    @Override
    public void onVisibilityChanged(boolean isVisible) {
      visible = isVisible;
      Log.i(TAG, "PARALLAX_VISIBILITY_CHANGED visible=" + isVisible);
      if (isVisible) {
        reloadCompositionRequested = true;
        calibrated = false;
        calibrationSamples = 0;
        pitchSum = 0;
        rollSum = 0;
        motionX = 0;
        motionY = 0;
        lastTimestamp = 0;
        registerSensor();
        requestFrame(true);
      } else {
        unregisterSensor();
      }
    }

    @Override
    public void onSurfaceCreated(SurfaceHolder holder) {
      super.onSurfaceCreated(holder);
      surfaceReady = true;
      reloadCompositionRequested = true;
      Log.i(TAG, "PARALLAX_SURFACE_CREATED valid=" + holder.getSurface().isValid());
      if (visible) registerSensor();
      requestFrame(true);
    }

    @Override
    public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
      super.onSurfaceChanged(holder, format, width, height);
      surfaceReady = true;
      reloadCompositionRequested = true;
      Log.i(TAG, "PARALLAX_SURFACE_CHANGED width=" + width + " height=" + height + " valid=" + holder.getSurface().isValid());
      requestFrame(true);
    }

    @Override
    public void onSurfaceDestroyed(SurfaceHolder holder) {
      surfaceReady = false;
      unregisterSensor();
      Log.i(TAG, "PARALLAX_SURFACE_DESTROYED");
      super.onSurfaceDestroyed(holder);
    }

    @Override
    public void onDestroy() {
      destroyed = true;
      surfaceReady = false;
      unregisterSensor();
      renderHandler.removeCallbacksAndMessages(null);
      renderHandler.post(new Runnable() {
        @Override
        public void run() {
          recycleBitmaps();
          renderThread.quitSafely();
        }
      });
      Log.i(TAG, "PARALLAX_ENGINE_DESTROYED");
      super.onDestroy();
    }

    private void registerSensor() {
      if (!sensorRegistered && sensorManager != null && rotationSensor != null) {
        sensorManager.registerListener(this, rotationSensor, 16000);
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

    private void prepareComposition() {
      if (!reloadCompositionRequested && composition != null) return;
      reloadCompositionRequested = false;
      String json = getSharedPreferences("parallax_wallpaper", MODE_PRIVATE).getString("composition", null);
      if (json == null) {
        composition = null;
        compositionJson = null;
        recycleBitmaps();
        Log.w(TAG, "PARALLAX_COMPOSITION_MISSING");
        return;
      }
      if (json.equals(compositionJson) && composition != null) return;

      try {
        JSONObject nextComposition = new JSONObject(json);
        recycleBitmaps();
        composition = nextComposition;
        compositionJson = json;
        intensity = (float) nextComposition.optDouble("intensity", 60) / 60f;
        JSONObject layers = nextComposition.optJSONObject("layers");
        if (layers != null) {
          bitmaps[0] = loadLayerBitmap(layers.optJSONObject("background"), 0);
          bitmaps[1] = loadLayerBitmap(layers.optJSONObject("middle"), 1);
          bitmaps[2] = loadLayerBitmap(layers.optJSONObject("foreground"), 2);
        }
        Log.i(TAG, "PARALLAX_COMPOSITION_READY");
      } catch (Exception error) {
        composition = null;
        compositionJson = null;
        recycleBitmaps();
        Log.e(TAG, "PARALLAX_COMPOSITION_FAILED", error);
      }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
      if (!visible || event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) return;
      SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
      WindowManager windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
      Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
      float[] workingMatrix = rotationMatrix;
      if (display != null) {
        int axisX = SensorManager.AXIS_X;
        int axisY = SensorManager.AXIS_Y;
        switch (display.getRotation()) {
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
        SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remappedMatrix);
        workingMatrix = remappedMatrix;
      }
      SensorManager.getOrientation(workingMatrix, orientation);
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

      float dt = lastTimestamp == 0 ? 1f / 60f : Math.max(0.004f, Math.min(0.25f, (event.timestamp - lastTimestamp) / 1000000000f));
      lastTimestamp = event.timestamp;
      float targetX = softLimit((float) Math.toDegrees(shortestAngleDelta(roll, baselineRoll)) * 0.45f * intensity, 18f);
      float targetY = softLimit((float) Math.toDegrees(shortestAngleDelta(pitch, baselinePitch)) * 0.4f * intensity, 15f);
      float filter = 1f - (float) Math.exp(-10f * dt);
      motionX += (targetX - motionX) * filter;
      motionY += (targetY - motionY) * filter;
      long now = SystemClock.elapsedRealtime();
      if (now - lastSensorLogAt >= DIAGNOSTIC_LOG_INTERVAL_MS) {
        lastSensorLogAt = now;
        Log.d(TAG, "PARALLAX_SENSOR_EVENT motionX=" + motionX + " motionY=" + motionY);
      }
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

    private Bitmap loadLayerBitmap(JSONObject layer, int index) {
      if (layer == null || !layer.optBoolean("enabled", true)) return null;
      String uriString = layer.optString("uri", "");
      if (uriString.length() == 0) return null;
      Log.i(TAG, "PARALLAX_BITMAP_LOAD index=" + index);
      try {
        Uri uri = Uri.parse(uriString);
        Bitmap bitmap;
        if ("content".equals(uri.getScheme())) {
          try (InputStream stream = getContentResolver().openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(stream);
          }
        } else {
          String path = "file".equals(uri.getScheme()) ? uri.getPath() : uriString;
          bitmap = BitmapFactory.decodeFile(path);
        }
        if (bitmap == null) {
          Log.w(TAG, "PARALLAX_BITMAP_LOAD_FAILED index=" + index + " reason=decode_null");
        } else {
          Log.i(TAG, "PARALLAX_BITMAP_READY index=" + index + " width=" + bitmap.getWidth() + " height=" + bitmap.getHeight());
        }
        return bitmap;
      } catch (Exception error) {
        Log.e(TAG, "PARALLAX_BITMAP_LOAD_FAILED index=" + index, error);
        return null;
      }
    }

    private void recycleBitmaps() {
      for (int index = 0; index < bitmaps.length; index += 1) {
        Bitmap bitmap = bitmaps[index];
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        bitmaps[index] = null;
      }
    }

    private void requestFrame(boolean force) {
      if (destroyed) return;
      synchronized (frameLock) {
        redrawRequested = true;
        forceDrawRequested = forceDrawRequested || force;
        if (frameQueued) return;
        frameQueued = true;
      }
      renderHandler.post(renderRunnable);
    }

    private boolean shouldLogFrame(boolean force) {
      long now = SystemClock.elapsedRealtime();
      if (force || !firstFrameDrawn || now - lastFrameLogAt >= DIAGNOSTIC_LOG_INTERVAL_MS) {
        lastFrameLogAt = now;
        return true;
      }
      return false;
    }

    private void drawFrame(boolean force) {
      prepareComposition();
      boolean logFrame = shouldLogFrame(force);
      if (!force && !visible) {
        if (logFrame) Log.d(TAG, "PARALLAX_DRAW_SKIP_NOT_VISIBLE");
        return;
      }
      if (!surfaceReady) {
        if (logFrame) Log.d(TAG, "PARALLAX_DRAW_SKIP_NO_SURFACE");
        return;
      }
      if (composition == null) {
        Log.w(TAG, "PARALLAX_DRAW_SKIP_NO_COMPOSITION");
        return;
      }
      SurfaceHolder holder = getSurfaceHolder();
      if (holder.getSurface() == null || !holder.getSurface().isValid()) {
        Log.w(TAG, "PARALLAX_DRAW_SKIP_NO_SURFACE");
        return;
      }
      Canvas canvas = null;
      boolean posted = false;
      try {
        if (logFrame) Log.d(TAG, "PARALLAX_DRAW_START force=" + force);
        if (logFrame) Log.d(TAG, "PARALLAX_LOCK_CANVAS");
        canvas = holder.lockCanvas();
        if (canvas == null) {
          Log.w(TAG, "PARALLAX_LOCK_CANVAS_FAILED reason=null_canvas");
          return;
        }
        if (logFrame) Log.d(TAG, "PARALLAX_LOCK_CANVAS_SUCCESS");
        canvas.drawColor(Color.BLACK);
        float canvasWidth = canvas.getWidth();
        float canvasHeight = canvas.getHeight();
        float sourceCanvasWidth = (float) composition.optDouble("canvasWidth", 280);
        float coordinateScale = canvasWidth / sourceCanvasWidth;
        JSONObject layers = composition.optJSONObject("layers");
        if (layers == null) return;
        drawLayer(canvas, layers.optJSONObject("background"), 0, canvasWidth, canvasHeight, coordinateScale);
        drawLayer(canvas, layers.optJSONObject("middle"), 1, canvasWidth, canvasHeight, coordinateScale);
        drawLayer(canvas, layers.optJSONObject("foreground"), 2, canvasWidth, canvasHeight, coordinateScale);
        posted = true;
      } catch (Exception error) {
        Log.e(TAG, "PARALLAX_DRAW_FAILED", error);
      } finally {
        if (canvas != null) {
          try {
            holder.unlockCanvasAndPost(canvas);
          } catch (Exception error) {
            posted = false;
            Log.e(TAG, "PARALLAX_UNLOCK_CANVAS_FAILED", error);
          }
        }
      }
      if (posted) {
        firstFrameDrawn = true;
        if (logFrame) Log.d(TAG, "PARALLAX_DRAW_COMPLETE");
      }
    }

    private void drawLayer(Canvas canvas, JSONObject layer, int index, float canvasWidth, float canvasHeight, float coordinateScale) {
      if (layer == null || !layer.optBoolean("enabled", true)) return;
      String uri = layer.optString("uri", "");
      if (uri.length() == 0) return;
      Bitmap bitmap = bitmaps[index];
      if (bitmap == null || bitmap.isRecycled()) return;

      float originalWidth = (float) layer.optDouble("imageWidth", bitmap.getWidth());
      float originalHeight = (float) layer.optDouble("imageHeight", bitmap.getHeight());
      float fitScale = Math.max(canvasWidth / originalWidth, canvasHeight / originalHeight);
      float layerScale = (float) layer.optDouble("scale", 1);
      float drawScale = fitScale * layerScale;
      float layerX = (float) layer.optDouble("x", 0) * coordinateScale;
      float layerY = (float) layer.optDouble("y", 0) * coordinateScale;
      float multiplier = (float) layer.optDouble("parallaxMultiplier", index == 0 ? 1 : index == 1 ? 1.7 : 2.5);
      float motionLeft = motionX * multiplier * coordinateScale;
      float motionTop = motionY * multiplier * coordinateScale;
      JSONObject crop = layer.optJSONObject("sourceCrop");
      RectF destination;

      if (crop != null) {
        float cropX = (float) crop.optDouble("originX", 0);
        float cropY = (float) crop.optDouble("originY", 0);
        float cropWidth = (float) crop.optDouble("width", bitmap.getWidth());
        float cropHeight = (float) crop.optDouble("height", bitmap.getHeight());
        float left = (canvasWidth - originalWidth * drawScale) / 2f + cropX * drawScale + layerX + motionLeft;
        float top = (canvasHeight - originalHeight * drawScale) / 2f + cropY * drawScale + layerY + motionTop;
        destination = new RectF(left, top, left + cropWidth * drawScale, top + cropHeight * drawScale);
      } else {
        float width = bitmap.getWidth() * drawScale;
        float height = bitmap.getHeight() * drawScale;
        float left = (canvasWidth - width) / 2f + layerX + motionLeft;
        float top = (canvasHeight - height) / 2f + layerY + motionTop;
        destination = new RectF(left, top, left + width, top + height);
      }
      canvas.drawBitmap(bitmap, null, destination, paint);
    }
  }
}
`;

const PARALLAX_XML = `<wallpaper xmlns:android="http://schemas.android.com/apk/res/android" />\n`;

module.exports = function withParallaxLiveWallpaper(config) {
  config = withParallaxWallpaperManifest(config);
  config = withParallaxWallpaperMainApplication(config);
  config = withParallaxWallpaperFiles(config);
  return config;
};
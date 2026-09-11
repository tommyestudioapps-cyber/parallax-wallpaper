package com.parallaxwallpaper.app;

import android.content.Context;
import android.content.ComponentCallbacks2;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.SystemClock;
import android.view.SurfaceHolder;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

public final class CanvasWallpaperRenderer implements WallpaperRenderer {
  private static final String TAG = "ParallaxWallpaper";
  private static final long DIAGNOSTIC_LOG_INTERVAL_MS = 2000L;
  private static final int METRICS_FRAME_WINDOW = 60;
  private static final long METRICS_TIME_WINDOW_MS = 5000L;
  private static final String PREFS_NAME = ParallaxWallpaperService.PREFS_NAME;
  private static final String PREF_COMPOSITION = "composition";

  private static final class SurfaceState {
    final SurfaceHolder holder;
    final int width;
    final int height;
    final boolean ready;

    SurfaceState(SurfaceHolder holder, int width, int height, boolean ready) {
      this.holder = holder;
      this.width = width;
      this.height = height;
      this.ready = ready;
    }
  }

  private final Context context;
  private final AtomicLong totalSensorEvents;
  private final AtomicLong skippedSensorFrames;
  private final AtomicLong requestedFrames;
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
  private final Bitmap[] bitmaps = new Bitmap[ParallaxComposition.LAYER_COUNT];
  private final RectF[] layerDestinationRects = {
    new RectF(),
    new RectF(),
    new RectF()
  };
  private final int[] bitmapSourceWidths = new int[ParallaxComposition.LAYER_COUNT];
  private final int[] bitmapSourceHeights = new int[ParallaxComposition.LAYER_COUNT];

  private volatile SurfaceState surfaceState =
      new SurfaceState(null, 0, 0, false);
  private volatile ParallaxComposition composition;
  private volatile ParallaxSensorState sensorState = ParallaxSensorState.ZERO;
  private volatile boolean visible;
  private volatile boolean reloadCompositionRequested = true;
  private volatile float intensity = 1f;
  private boolean forceDrawRequested;
  private boolean firstFrameDrawn;
  private String compositionJson;
  private String compositionLayerKey;
  private long lastFrameLogAt;
  private long metricsWindowStartedAtMs;
  private long metricsWindowDrawnFrames;
  private long metricsWindowRenderNanos;
  private long metricsWindowMaxRenderNanos;
  private final AtomicLong drawnFrames = new AtomicLong();

  public CanvasWallpaperRenderer(
      Context context,
      AtomicLong totalSensorEvents,
      AtomicLong skippedSensorFrames,
      AtomicLong requestedFrames) {
    this.context = context;
    this.totalSensorEvents = totalSensorEvents;
    this.skippedSensorFrames = skippedSensorFrames;
    this.requestedFrames = requestedFrames;
  }

  @Override
  public void onSurfaceCreated(SurfaceHolder holder) {
    android.graphics.Rect frame = holder.getSurfaceFrame();
    int width = frame == null ? 0 : frame.width();
    int height = frame == null ? 0 : frame.height();
    surfaceState = new SurfaceState(holder, width, height, true);
    reloadCompositionRequested = true;
  }

  @Override
  public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
    surfaceState = new SurfaceState(holder, width, height, true);
    reloadCompositionRequested = true;
  }

  @Override
  public void onSurfaceDestroyed(SurfaceHolder holder) {
    SurfaceState current = surfaceState;
    if (current.holder == holder) {
      surfaceState = new SurfaceState(null, 0, 0, false);
    }
  }

  @Override
  public void updateSensorState(ParallaxSensorState sensorState) {
    this.sensorState = sensorState == null ? ParallaxSensorState.ZERO : sensorState;
  }

  @Override
  public void setVisible(boolean visible) {
    this.visible = visible;
  }

  @Override
  public void setComposition(ParallaxComposition composition) {
    this.composition = composition;
    if (composition == null) {
      compositionJson = null;
      compositionLayerKey = null;
      return;
    }
    compositionJson = composition.getSourceJson();
    intensity = composition.getIntensity();
    reloadCompositionRequested = false;
  }

  @Override
  public void setForceDraw(boolean force) {
    forceDrawRequested = force;
  }

  @Override
  public void invalidateComposition() {
    reloadCompositionRequested = true;
  }

  @Override
  public float getIntensity() {
    return intensity;
  }

  @Override
  public void renderFrame() {
    boolean force = forceDrawRequested;
    forceDrawRequested = false;
    drawFrame(force);
  }

  @Override
  public void release() {
    recycleBitmaps();
    composition = null;
    compositionJson = null;
    compositionLayerKey = null;
    surfaceState = new SurfaceState(null, 0, 0, false);
  }

  @Override
  public void onTrimMemory(int level) {
    if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return;
    recycleBitmaps();
    composition = null;
    compositionJson = null;
    compositionLayerKey = null;
    reloadCompositionRequested = true;
    AppLog.i("PARALLAX_CANVAS_TRIM_MEMORY level=" + level);
  }

  private void prepareComposition(int targetWidth, int targetHeight) {
    if (!reloadCompositionRequested && composition != null) return;

    String json = context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_COMPOSITION, null);
    if (json == null) {
      reloadCompositionRequested = false;
      composition = null;
      compositionJson = null;
      compositionLayerKey = null;
      recycleBitmaps();
      AppLog.w("PARALLAX_COMPOSITION_MISSING");
      return;
    }
    if (json.equals(compositionJson) && composition != null) {
      reloadCompositionRequested = false;
      return;
    }

    try {
      JSONObject nextComposition = new JSONObject(json);
      float nextIntensity = (float) nextComposition.optDouble("intensity", 60) / 60f;
      JSONObject layersJson = nextComposition.optJSONObject("layers");
      float canvasWidth = (float) nextComposition.optDouble("canvasWidth", 280);

      String nextLayerKey = buildLayerKey(layersJson, canvasWidth);
      boolean layersUnchanged =
          composition != null
              && nextLayerKey.equals(compositionLayerKey);

      if (layersUnchanged) {
        intensity = nextIntensity;
        compositionJson = json;
        composition = composition.withIntensity(json, nextIntensity);
        reloadCompositionRequested = false;
        AppLog.i("PARALLAX_COMPOSITION_INTENSITY_ONLY");
        return;
      }

      recycleBitmaps();
      ParallaxComposition.Layer[] nextLayers =
          new ParallaxComposition.Layer[ParallaxComposition.LAYER_COUNT];
      if (layersJson != null) {
        String[] layerNames = {"background", "middle", "foreground"};
        for (int index = 0; index < layerNames.length; index += 1) {
          JSONObject layerJson = layersJson.optJSONObject(layerNames[index]);
          nextLayers[index] = createLayer(layerJson, index, targetWidth, targetHeight);
        }
      }
      compositionLayerKey = nextLayerKey;
      setComposition(new ParallaxComposition(
          json,
          canvasWidth,
          nextIntensity,
          layersJson != null,
          nextLayers));
      AppLog.i("PARALLAX_COMPOSITION_READY");
    } catch (Exception error) {
      composition = null;
      compositionJson = null;
      compositionLayerKey = null;
      recycleBitmaps();
      AppLog.e("PARALLAX_COMPOSITION_FAILED", error);
    }
  }

  private String buildLayerKey(JSONObject layersJson, float canvasWidth) {
    String layersString = layersJson == null ? "null" : layersJson.toString();
    return canvasWidth + "|" + layersString;
  }

  private ParallaxComposition.Layer createLayer(
      JSONObject layer,
      int index,
      int targetWidth,
      int targetHeight) {
    if (layer == null || !layer.optBoolean("enabled", true)) return null;
    String uriString = layer.optString("uri", "");
    if (uriString.length() == 0) return null;

    Bitmap bitmap = loadLayerBitmap(layer, index, targetWidth, targetHeight);
    int fallbackWidth = bitmap == null ? 0 : bitmap.getWidth();
    int fallbackHeight = bitmap == null ? 0 : bitmap.getHeight();
    JSONObject crop = layer.optJSONObject("sourceCrop");
    int sourceWidth = bitmapSourceWidths[index] > 0 ? bitmapSourceWidths[index] : fallbackWidth;
    int sourceHeight = bitmapSourceHeights[index] > 0 ? bitmapSourceHeights[index] : fallbackHeight;
    float imageWidth = (float) layer.optDouble("imageWidth", fallbackWidth);
    float imageHeight = (float) layer.optDouble("imageHeight", fallbackHeight);
    float multiplier = (float) layer.optDouble(
        "parallaxMultiplier",
        index == 0 ? 1 : index == 1 ? 1.7 : 2.5);
    return new ParallaxComposition.Layer(
        bitmap,
        sourceWidth,
        sourceHeight,
        imageWidth,
        imageHeight,
        (float) layer.optDouble("scale", 1),
        (float) layer.optDouble("x", 0),
        (float) layer.optDouble("y", 0),
        multiplier,
        crop != null,
        crop == null ? 0 : (float) crop.optDouble("originX", 0),
        crop == null ? 0 : (float) crop.optDouble("originY", 0),
        crop == null ? 0 : (float) crop.optDouble("width", fallbackWidth),
        crop == null ? 0 : (float) crop.optDouble("height", fallbackHeight));
  }

  private Bitmap loadLayerBitmap(JSONObject layer, int index, int targetWidth, int targetHeight) {
    if (layer == null || !layer.optBoolean("enabled", true)) return null;
    String uriString = layer.optString("uri", "");
    if (uriString.length() == 0) return null;
    AppLog.i("PARALLAX_BITMAP_LOAD index=" + index);
    try {
      Uri uri = Uri.parse(uriString);
      String path = "file".equals(uri.getScheme()) ? uri.getPath() : uriString;
      BitmapFactory.Options boundsOptions = new BitmapFactory.Options();
      boundsOptions.inJustDecodeBounds = true;
      if ("content".equals(uri.getScheme())) {
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
          BitmapFactory.decodeStream(stream, null, boundsOptions);
        }
      } else {
        BitmapFactory.decodeFile(path, boundsOptions);
      }

      int sourceWidth = boundsOptions.outWidth;
      int sourceHeight = boundsOptions.outHeight;
      int sampleSize = calculateInSampleSize(layer, sourceWidth, sourceHeight, targetWidth, targetHeight);
      BitmapFactory.Options decodeOptions = new BitmapFactory.Options();
      decodeOptions.inSampleSize = sampleSize;

      Bitmap bitmap;
      if ("content".equals(uri.getScheme())) {
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
          bitmap = BitmapFactory.decodeStream(stream, null, decodeOptions);
        }
      } else {
        bitmap = BitmapFactory.decodeFile(path, decodeOptions);
      }
      if (bitmap == null) {
        AppLog.w("PARALLAX_BITMAP_LOAD_FAILED index=" + index + " reason=decode_null");
      } else {
        bitmap = ExifOrientationHelper.applyOrientation(context, bitmap, uriString, index);
        bitmapSourceWidths[index] = bitmap.getWidth();
        bitmapSourceHeights[index] = bitmap.getHeight();
        boolean prewarmed = index == 0;
        if (prewarmed) bitmap.prepareToDraw();
        AppLog.i("PARALLAX_BITMAP_READY index=" + index + " width=" + bitmap.getWidth() + " height=" + bitmap.getHeight() + " sampleSize=" + sampleSize + " prewarmed=" + prewarmed);
      }
      return bitmap;
    } catch (Exception error) {
      AppLog.e("PARALLAX_BITMAP_LOAD_FAILED index=" + index, error);
      return null;
    }
  }

  private int calculateInSampleSize(
      JSONObject layer,
      int sourceWidth,
      int sourceHeight,
      int targetWidth,
      int targetHeight) {
    if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return 1;

    double imageWidth = layer.optDouble("imageWidth", sourceWidth);
    double imageHeight = layer.optDouble("imageHeight", sourceHeight);
    if (imageWidth <= 0 || imageHeight <= 0) return 1;

    double fitScale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
    double layerScale = Math.max(0.001, layer.optDouble("scale", 1));
    JSONObject crop = layer.optJSONObject("sourceCrop");
    double renderedWidth = crop == null ? imageWidth : crop.optDouble("width", imageWidth);
    double renderedHeight = crop == null ? imageHeight : crop.optDouble("height", imageHeight);
    double requiredWidth = renderedWidth * fitScale * layerScale;
    double requiredHeight = renderedHeight * fitScale * layerScale;

    int sampleSize = 1;
    while (sourceWidth / (sampleSize * 2) >= requiredWidth
        && sourceHeight / (sampleSize * 2) >= requiredHeight) {
      sampleSize *= 2;
    }
    return sampleSize;
  }

  private void recycleBitmaps() {
    for (int index = 0; index < bitmaps.length; index += 1) {
      Bitmap bitmap = bitmaps[index];
      if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
      bitmaps[index] = null;
      bitmapSourceWidths[index] = 0;
      bitmapSourceHeights[index] = 0;
    }
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
    boolean logFrame = shouldLogFrame(force);
    if (!visible) {
      if (logFrame) AppLog.d("PARALLAX_DRAW_SKIP_NOT_VISIBLE");
      return;
    }
    SurfaceState snapshot = surfaceState;
    if (!snapshot.ready) {
      if (logFrame) AppLog.d("PARALLAX_DRAW_SKIP_NO_SURFACE");
      return;
    }
    SurfaceHolder holder = snapshot.holder;
    if (holder == null || holder.getSurface() == null || !holder.getSurface().isValid()) {
      if (logFrame) AppLog.w("PARALLAX_DRAW_SKIP_NO_SURFACE");
      return;
    }
    int surfaceWidth = snapshot.width;
    int surfaceHeight = snapshot.height;
    long prepareStartNanos = SystemClock.elapsedRealtimeNanos();
    prepareComposition(surfaceWidth, surfaceHeight);
    long prepareEndNanos = SystemClock.elapsedRealtimeNanos();
    if (logFrame) {
      AppLog.d("PARALLAX_COMPOSITION_TIMING prepare=" + durationMs(prepareStartNanos, prepareEndNanos) + "ms");
    }
    if (composition == null) {
      AppLog.w("PARALLAX_DRAW_SKIP_NO_COMPOSITION");
      return;
    }

    long renderStartNanos = SystemClock.elapsedRealtimeNanos();
    Canvas canvas = null;
    boolean posted = false;
    long renderEndNanos = 0L;
    long drawStartNanos = 0L;
    long lockStartNanos = 0L;
    long lockEndNanos = 0L;
    long clearStartNanos = 0L;
    long clearEndNanos = 0L;
    long backgroundStartNanos = 0L;
    long backgroundEndNanos = 0L;
    long middleStartNanos = 0L;
    long middleEndNanos = 0L;
    long foregroundStartNanos = 0L;
    long foregroundEndNanos = 0L;
    long unlockStartNanos = 0L;
    long unlockEndNanos = 0L;
    try {
      if (logFrame) {
        drawStartNanos = SystemClock.elapsedRealtimeNanos();
        AppLog.d("PARALLAX_DRAW_START force=" + force);
      }
      if (logFrame) AppLog.d("PARALLAX_LOCK_CANVAS");
      if (logFrame) lockStartNanos = SystemClock.elapsedRealtimeNanos();
      canvas = holder.lockCanvas();
      if (logFrame) lockEndNanos = SystemClock.elapsedRealtimeNanos();
      if (canvas == null) {
        AppLog.w("PARALLAX_LOCK_CANVAS_FAILED reason=null_canvas");
        return;
      }
      if (logFrame) AppLog.d("PARALLAX_LOCK_CANVAS_SUCCESS");
      if (logFrame) clearStartNanos = SystemClock.elapsedRealtimeNanos();
      canvas.drawColor(Color.BLACK);
      if (logFrame) clearEndNanos = SystemClock.elapsedRealtimeNanos();
      float canvasWidth = canvas.getWidth();
      float canvasHeight = canvas.getHeight();
      float coordinateScale = canvasWidth / composition.getCanvasWidth();
      if (!composition.hasLayers()) return;
      if (logFrame) backgroundStartNanos = SystemClock.elapsedRealtimeNanos();
      drawLayer(canvas, composition.getLayer(0), 0, canvasWidth, canvasHeight, coordinateScale);
      if (logFrame) backgroundEndNanos = SystemClock.elapsedRealtimeNanos();
      if (logFrame) middleStartNanos = SystemClock.elapsedRealtimeNanos();
      drawLayer(canvas, composition.getLayer(1), 1, canvasWidth, canvasHeight, coordinateScale);
      if (logFrame) middleEndNanos = SystemClock.elapsedRealtimeNanos();
      if (logFrame) foregroundStartNanos = SystemClock.elapsedRealtimeNanos();
      drawLayer(canvas, composition.getLayer(2), 2, canvasWidth, canvasHeight, coordinateScale);
      if (logFrame) foregroundEndNanos = SystemClock.elapsedRealtimeNanos();
      posted = true;
    } catch (Exception error) {
      AppLog.e("PARALLAX_DRAW_FAILED", error);
    } finally {
      if (canvas != null) {
        if (logFrame) {
          unlockStartNanos = SystemClock.elapsedRealtimeNanos();
          AppLog.d("PARALLAX_BEFORE_UNLOCK");
        }
        try {
          holder.unlockCanvasAndPost(canvas);
          if (logFrame) unlockEndNanos = SystemClock.elapsedRealtimeNanos();
        } catch (Exception error) {
          posted = false;
          AppLog.e("PARALLAX_UNLOCK_CANVAS_FAILED", error);
        }
      }
      renderEndNanos = SystemClock.elapsedRealtimeNanos();
      if (logFrame) {
        AppLog.d(
            "PARALLAX_FRAME_TIMING"
                + " total=" + durationMs(drawStartNanos, renderEndNanos) + "ms"
                + " lock=" + durationMs(lockStartNanos, lockEndNanos) + "ms"
                + " clear=" + durationMs(clearStartNanos, clearEndNanos) + "ms"
                + " background=" + durationMs(backgroundStartNanos, backgroundEndNanos) + "ms"
                + " middle=" + durationMs(middleStartNanos, middleEndNanos) + "ms"
                + " foreground=" + durationMs(foregroundStartNanos, foregroundEndNanos) + "ms"
                + " unlockPost=" + durationMs(unlockStartNanos, unlockEndNanos) + "ms"
                + " force=" + force
                + " posted=" + posted);
      }
    }
    if (posted) {
      firstFrameDrawn = true;
      recordDrawnFrame(renderEndNanos - renderStartNanos);
      if (logFrame) AppLog.d("PARALLAX_DRAW_COMPLETE");
    }
  }

  private void recordDrawnFrame(long renderDurationNanos) {
    drawnFrames.incrementAndGet();
    long now = SystemClock.elapsedRealtime();
    if (metricsWindowStartedAtMs == 0L) metricsWindowStartedAtMs = now;
    metricsWindowDrawnFrames += 1L;
    metricsWindowRenderNanos += Math.max(0L, renderDurationNanos);
    metricsWindowMaxRenderNanos = Math.max(metricsWindowMaxRenderNanos, renderDurationNanos);

    if (metricsWindowDrawnFrames < METRICS_FRAME_WINDOW
        && now - metricsWindowStartedAtMs < METRICS_TIME_WINDOW_MS) {
      return;
    }

    long sensorEvents = totalSensorEvents.get();
    long skippedFrames = skippedSensorFrames.get();
    double deadZoneRetention =
        sensorEvents == 0L ? 0.0 : (skippedFrames * 100.0) / sensorEvents;
    double averageRenderMs =
        metricsWindowRenderNanos / (double) metricsWindowDrawnFrames / 1000000.0;
    double maxRenderMs = metricsWindowMaxRenderNanos / 1000000.0;
    AppLog.i(
        "PARALLAX_CANVAS_METRICS"
            + " deadZoneRetention=" + deadZoneRetention + "%"
            + " averageRenderMs=" + averageRenderMs
            + " maxRenderMs=" + maxRenderMs
            + " drawnFrames=" + drawnFrames.get()
            + " requestedFrames=" + requestedFrames.get()
            + " totalSensorEvents=" + sensorEvents
            + " skippedSensorFrames=" + skippedFrames
            + " windowDrawnFrames=" + metricsWindowDrawnFrames);

    metricsWindowStartedAtMs = now;
    metricsWindowDrawnFrames = 0L;
    metricsWindowRenderNanos = 0L;
    metricsWindowMaxRenderNanos = 0L;
  }

  private long durationMs(long startNanos, long endNanos) {
    if (startNanos == 0L || endNanos == 0L) return -1L;
    return (endNanos - startNanos) / 1000000L;
  }

  private void drawLayer(
      Canvas canvas,
      ParallaxComposition.Layer layer,
      int index,
      float canvasWidth,
      float canvasHeight,
      float coordinateScale) {
    if (layer == null) return;
    Bitmap bitmap = layer.getBitmap();
    if (bitmap == null || bitmap.isRecycled()) return;

    float originalWidth = layer.getImageWidth();
    float originalHeight = layer.getImageHeight();
    float fitScale = Math.max(canvasWidth / originalWidth, canvasHeight / originalHeight);
    float drawScale = fitScale * layer.getScale();
    float layerX = layer.getX() * coordinateScale;
    float layerY = layer.getY() * coordinateScale;
    float multiplier = layer.getParallaxMultiplier();
    ParallaxSensorState snapshot = sensorState;
    float motionLeft = snapshot.getX() * multiplier * coordinateScale;
    float motionTop = snapshot.getY() * multiplier * coordinateScale;
    RectF destination = layerDestinationRects[index];

    if (layer.hasSourceCrop()) {
      float cropX = layer.getCropOriginX();
      float cropY = layer.getCropOriginY();
      float cropWidth = layer.getCropWidth();
      float cropHeight = layer.getCropHeight();
      float left = (canvasWidth - originalWidth * drawScale) / 2f
          + cropX * drawScale + layerX + motionLeft;
      float top = (canvasHeight - originalHeight * drawScale) / 2f
          + cropY * drawScale + layerY + motionTop;
      destination.set(left, top, left + cropWidth * drawScale, top + cropHeight * drawScale);
    } else {
      float sourceWidth = layer.getSourceWidth() > 0 ? layer.getSourceWidth() : bitmap.getWidth();
      float sourceHeight = layer.getSourceHeight() > 0 ? layer.getSourceHeight() : bitmap.getHeight();
      float width = sourceWidth * drawScale;
      float height = sourceHeight * drawScale;
      float left = (canvasWidth - width) / 2f + layerX + motionLeft;
      float top = (canvasHeight - height) / 2f + layerY + motionTop;
      destination.set(left, top, left + width, top + height);
    }
    canvas.drawBitmap(bitmap, null, destination, paint);
  }
}
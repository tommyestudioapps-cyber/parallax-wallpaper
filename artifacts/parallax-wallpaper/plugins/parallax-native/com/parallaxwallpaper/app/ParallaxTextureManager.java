package com.parallaxwallpaper.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.util.Log;
import java.io.InputStream;
import org.json.JSONObject;

public final class ParallaxTextureManager {
  private static final String TAG = "ParallaxWallpaper";
  private static final int LAYER_COUNT = 3;
  private static final String[] LAYER_NAMES = {"background", "middle", "foreground"};
  private static final float[] DEFAULT_DEPTH_FACTORS = {0.2f, 0.5f, 1f};
  private static final String PREFS_NAME = ParallaxWallpaperService.PREFS_NAME;
  private static final String PREF_COMPOSITION = "composition";

  public static final class LayerData {
    public int textureId;
    public int textureWidth;
    public int textureHeight;
    public float imageWidth;
    public float imageHeight;
    public float sourceWidth;
    public float sourceHeight;
    public float scale = 1f;
    public float x;
    public float y;
    public float parallaxMultiplier;
    public boolean hasSourceCrop;
    public float cropOriginX;
    public float cropOriginY;
    public float cropWidth;
    public float cropHeight;
  }

  private final Context context;
  private final int[] mTextureIds = new int[LAYER_COUNT];
  private final float[] mDepthFactors = new float[LAYER_COUNT];
  private final LayerData[] mLayerData = new LayerData[LAYER_COUNT];
  private float mCompositionCanvasWidth = 280f;
  private boolean texturesLoaded;

  public ParallaxTextureManager(Context context) {
    this.context = context.getApplicationContext();
    resetDepthFactors();
    for (int index = 0; index < LAYER_COUNT; index += 1) {
      mLayerData[index] = new LayerData();
    }
  }

  public int[] loadTextures(int targetWidth, int targetHeight) {
    if (texturesLoaded) return mTextureIds;
    texturesLoaded = true;

    String json = context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_COMPOSITION, null);
    if (json == null) {
      Log.w(TAG, "PARALLAX_GL_COMPOSITION_MISSING");
      return mTextureIds;
    }

    try {
      JSONObject composition = new JSONObject(json);
      mCompositionCanvasWidth = (float) composition.optDouble("canvasWidth", 280);
      JSONObject layers = composition.optJSONObject("layers");
      for (int index = 0; index < LAYER_COUNT; index += 1) {
        JSONObject layerJson =
            layers == null ? null : layers.optJSONObject(LAYER_NAMES[index]);
        populateLayerData(mLayerData[index], layerJson, index);
        mDepthFactors[index] = mLayerData[index].parallaxMultiplier;
        Bitmap bitmap = loadLayerBitmap(layerJson, index, targetWidth, targetHeight);
        if (bitmap != null && !bitmap.isRecycled()) {
          mLayerData[index].textureWidth = bitmap.getWidth();
          mLayerData[index].textureHeight = bitmap.getHeight();
          uploadTexture(bitmap, index);
          mLayerData[index].textureId = mTextureIds[index];
        } else {
          Log.w(TAG, "PARALLAX_GL_TEXTURE_MISSING index=" + index);
        }
      }
    } catch (Exception error) {
      Log.e(TAG, "PARALLAX_GL_COMPOSITION_FAILED", error);
    }
    return mTextureIds;
  }

  private void populateLayerData(LayerData data, JSONObject layer, int index) {
    if (layer == null || !layer.optBoolean("enabled", true)) {
      data.parallaxMultiplier = DEFAULT_DEPTH_FACTORS[index];
      data.imageWidth = 0;
      data.imageHeight = 0;
      data.sourceWidth = 0;
      data.sourceHeight = 0;
      data.scale = 1f;
      data.x = 0;
      data.y = 0;
      data.hasSourceCrop = false;
      data.cropOriginX = 0;
      data.cropOriginY = 0;
      data.cropWidth = 0;
      data.cropHeight = 0;
      return;
    }
    data.imageWidth = (float) layer.optDouble("imageWidth", 0);
    data.imageHeight = (float) layer.optDouble("imageHeight", 0);
    data.scale = (float) layer.optDouble("scale", 1);
    data.x = (float) layer.optDouble("x", 0);
    data.y = (float) layer.optDouble("y", 0);
    data.parallaxMultiplier = (float) layer.optDouble(
        "parallaxMultiplier",
        DEFAULT_DEPTH_FACTORS[index]);
    JSONObject crop = layer.optJSONObject("sourceCrop");
    data.hasSourceCrop = crop != null;
    data.cropOriginX = crop == null ? 0 : (float) crop.optDouble("originX", 0);
    data.cropOriginY = crop == null ? 0 : (float) crop.optDouble("originY", 0);
    data.cropWidth = crop == null ? 0 : (float) crop.optDouble("width", 0);
    data.cropHeight = crop == null ? 0 : (float) crop.optDouble("height", 0);
  }

  public void releaseTextures() {
    for (int index = 0; index < LAYER_COUNT; index += 1) {
      if (mTextureIds[index] != 0) {
        GLES20.glDeleteTextures(1, mTextureIds, index);
        Log.i(TAG, "PARALLAX_GL_TEXTURE_RELEASED index=" + index + " id=" + mTextureIds[index]);
        mTextureIds[index] = 0;
      }
      if (mLayerData[index] != null) {
        mLayerData[index].textureId = 0;
        mLayerData[index].textureWidth = 0;
        mLayerData[index].textureHeight = 0;
      }
    }
    resetDepthFactors();
    texturesLoaded = false;
  }

  public void release() {
    releaseTextures();
  }

  private void uploadTexture(Bitmap bitmap, int index) {
    GLES20.glGenTextures(1, mTextureIds, index);
    if (mTextureIds[index] == 0) {
      bitmap.recycle();
      Log.e(TAG, "PARALLAX_GL_TEXTURE_CREATE_FAILED index=" + index);
      return;
    }

    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, mTextureIds[index]);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_MIN_FILTER,
        GLES20.GL_LINEAR);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_MAG_FILTER,
        GLES20.GL_LINEAR);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_WRAP_S,
        GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_WRAP_T,
        GLES20.GL_CLAMP_TO_EDGE);
    try {
      GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
    } finally {
      bitmap.recycle();
    }

    int error = GLES20.glGetError();
    if (error != GLES20.GL_NO_ERROR) {
      Log.e(TAG,
          "PARALLAX_GL_TEXTURE_UPLOAD_FAILED index=" + index
              + " error=0x" + Integer.toHexString(error));
      GLES20.glDeleteTextures(1, mTextureIds, index);
      mTextureIds[index] = 0;
      if (mLayerData[index] != null) {
        mLayerData[index].textureId = 0;
        mLayerData[index].textureWidth = 0;
        mLayerData[index].textureHeight = 0;
      }
      return;
    }
    Log.i(TAG, "PARALLAX_GL_TEXTURE_CREATED index=" + index + " id=" + mTextureIds[index]);
  }

  public float getDepthFactor(int index) {
    return mDepthFactors[index];
  }

  public float getCompositionCanvasWidth() {
    return mCompositionCanvasWidth;
  }

  public LayerData getLayerData(int index) {
    return mLayerData[index];
  }

  private void resetDepthFactors() {
    for (int index = 0; index < LAYER_COUNT; index += 1) {
      mDepthFactors[index] = DEFAULT_DEPTH_FACTORS[index];
    }
  }

  private Bitmap loadLayerBitmap(
      JSONObject layer,
      int index,
      int targetWidth,
      int targetHeight) {
    if (layer == null || !layer.optBoolean("enabled", true)) return null;
    String uriString = layer.optString("uri", "");
    if (uriString.length() == 0) return null;
    Log.i(TAG, "PARALLAX_GL_BITMAP_LOAD index=" + index);

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
      int sampleSize = calculateInSampleSize(
          layer,
          sourceWidth,
          sourceHeight,
          targetWidth,
          targetHeight);
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
        Log.w(TAG, "PARALLAX_GL_BITMAP_LOAD_FAILED index=" + index + " reason=decode_null");
      } else {
        bitmap = ExifOrientationHelper.applyOrientation(context, bitmap, uriString, index);
        bitmap.prepareToDraw();
        LayerData data = mLayerData[index];
        data.sourceWidth = bitmap.getWidth();
        data.sourceHeight = bitmap.getHeight();
        if (data.imageWidth <= 0) data.imageWidth = data.sourceWidth;
        if (data.imageHeight <= 0) data.imageHeight = data.sourceHeight;
        Log.i(TAG,
            "PARALLAX_GL_BITMAP_READY index=" + index
                + " width=" + bitmap.getWidth()
                + " height=" + bitmap.getHeight()
                + " sampleSize=" + sampleSize);
      }
      return bitmap;
    } catch (Exception error) {
      Log.e(TAG, "PARALLAX_GL_BITMAP_LOAD_FAILED index=" + index, error);
      return null;
    }
  }

  private int calculateInSampleSize(
      JSONObject layer,
      int sourceWidth,
      int sourceHeight,
      int targetWidth,
      int targetHeight) {
    if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
      return 1;
    }

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
}
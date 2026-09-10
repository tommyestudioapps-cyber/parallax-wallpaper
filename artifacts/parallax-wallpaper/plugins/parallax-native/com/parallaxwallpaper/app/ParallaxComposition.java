package com.parallaxwallpaper.app;

import android.graphics.Bitmap;

public final class ParallaxComposition {
  public static final int LAYER_COUNT = 3;

  public static final class Layer {
    private final Bitmap bitmap;
    private final int sourceWidth;
    private final int sourceHeight;
    private final float imageWidth;
    private final float imageHeight;
    private final float scale;
    private final float x;
    private final float y;
    private final float parallaxMultiplier;
    private final boolean hasSourceCrop;
    private final float cropOriginX;
    private final float cropOriginY;
    private final float cropWidth;
    private final float cropHeight;

    public Layer(
        Bitmap bitmap,
        int sourceWidth,
        int sourceHeight,
        float imageWidth,
        float imageHeight,
        float scale,
        float x,
        float y,
        float parallaxMultiplier,
        boolean hasSourceCrop,
        float cropOriginX,
        float cropOriginY,
        float cropWidth,
        float cropHeight) {
      this.bitmap = bitmap;
      this.sourceWidth = sourceWidth;
      this.sourceHeight = sourceHeight;
      this.imageWidth = imageWidth;
      this.imageHeight = imageHeight;
      this.scale = scale;
      this.x = x;
      this.y = y;
      this.parallaxMultiplier = parallaxMultiplier;
      this.hasSourceCrop = hasSourceCrop;
      this.cropOriginX = cropOriginX;
      this.cropOriginY = cropOriginY;
      this.cropWidth = cropWidth;
      this.cropHeight = cropHeight;
    }

    public Bitmap getBitmap() {
      return bitmap;
    }

    public int getSourceWidth() {
      return sourceWidth;
    }

    public int getSourceHeight() {
      return sourceHeight;
    }

    public float getImageWidth() {
      return imageWidth;
    }

    public float getImageHeight() {
      return imageHeight;
    }

    public float getScale() {
      return scale;
    }

    public float getX() {
      return x;
    }

    public float getY() {
      return y;
    }

    public float getParallaxMultiplier() {
      return parallaxMultiplier;
    }

    public boolean hasSourceCrop() {
      return hasSourceCrop;
    }

    public float getCropOriginX() {
      return cropOriginX;
    }

    public float getCropOriginY() {
      return cropOriginY;
    }

    public float getCropWidth() {
      return cropWidth;
    }

    public float getCropHeight() {
      return cropHeight;
    }
  }

  private final String sourceJson;
  private final float canvasWidth;
  private final float intensity;
  private final boolean hasLayers;
  private final Layer[] layers;

  public ParallaxComposition(
      String sourceJson,
      float canvasWidth,
      float intensity,
      boolean hasLayers,
      Layer[] layers) {
    if (layers == null || layers.length != LAYER_COUNT) {
      throw new IllegalArgumentException("Parallax composition must contain exactly three layers.");
    }
    this.sourceJson = sourceJson;
    this.canvasWidth = canvasWidth;
    this.intensity = intensity;
    this.hasLayers = hasLayers;
    this.layers = layers.clone();
  }

  public ParallaxComposition withIntensity(String newSourceJson, float newIntensity) {
    return new ParallaxComposition(
        newSourceJson,
        canvasWidth,
        newIntensity,
        hasLayers,
        layers);
  }

  public String getSourceJson() {
    return sourceJson;
  }

  public float getCanvasWidth() {
    return canvasWidth;
  }

  public float getIntensity() {
    return intensity;
  }

  public boolean hasLayers() {
    return hasLayers;
  }

  public Layer getLayer(int index) {
    return layers[index];
  }
}
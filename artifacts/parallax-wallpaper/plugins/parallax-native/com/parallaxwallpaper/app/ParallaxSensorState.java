package com.parallaxwallpaper.app;

public final class ParallaxSensorState {
  public static final ParallaxSensorState ZERO = new ParallaxSensorState(0f, 0f);

  private final float x;
  private final float y;

  public ParallaxSensorState(float x, float y) {
    this.x = x;
    this.y = y;
  }

  public float getX() {
    return x;
  }

  public float getY() {
    return y;
  }
}
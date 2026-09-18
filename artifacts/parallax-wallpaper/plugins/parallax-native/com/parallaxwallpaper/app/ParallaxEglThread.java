package com.parallaxwallpaper.app;

import android.content.Context;
import android.graphics.Rect;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.view.SurfaceHolder;

public final class ParallaxEglThread extends Thread {
  private static final long VSYNC_BUDGET_NS = 16_666_667L;
  private static final long METRICS_FRAME_WINDOW = 60L;
  private static final long METRICS_TIME_WINDOW_NS = 5_000_000_000L;

  public interface Listener {
    void onEglReady(ParallaxEglThread thread);

    void onEglFailure(ParallaxEglThread thread, String reason);

    void onEglThreadTerminated(ParallaxEglThread thread);
  }

  private static final String TAG = "ParallaxWallpaper";

  private final SurfaceHolder surfaceHolder;
  private final Listener listener;
  private final Context context;
  private final Object frameLock = new Object();
  private volatile ParallaxSensorState sensorState = ParallaxSensorState.ZERO;
  private volatile boolean running = true;
  private boolean framePending = true;
  private ParallaxGlRenderer glRenderer;
  private long totalGlFrames;
  private long accumulatedDrawTimeNs;
  private double maxFrameTimeMs;
  private long droppedGlFrames;
  private long vsyncMisses;
  private long metricsWindowStartedAtNs;
  private long metricsWindowFrames;
  private long metricsWindowDrawTimeNs;
  private double metricsWindowMaxFrameTimeMs;
  private long metricsWindowSwapFailures;
  private double metricsWindowLastSwapMs;
  private boolean metricsWindowLastSwapSucceeded;
  private boolean failureReported;

  public ParallaxEglThread(SurfaceHolder surfaceHolder, Listener listener, Context context) {
    super("ParallaxWallpaperEgl");
    this.surfaceHolder = surfaceHolder;
    this.listener = listener;
    this.context = context.getApplicationContext();
  }

  public void requestStop() {
    synchronized (frameLock) {
      running = false;
      frameLock.notifyAll();
    }
  }

  public void requestFrame() {
    synchronized (frameLock) {
      framePending = true;
      frameLock.notifyAll();
    }
  }

  public void updateSensorState(ParallaxSensorState sensorState) {
    this.sensorState = sensorState == null ? ParallaxSensorState.ZERO : sensorState;
    requestFrame();
  }

  @Override
  public void run() {
    try {
      if (!initializeEgl()) {
        reportFailure("egl_initialization");
        return;
      }
      if (!initializeGlRenderer()) {
        reportFailure("gl_renderer_initialization");
        return;
      }

      boolean alphaPrecisionPassed = glRenderer.validateAlphaPrecision();
      AppLog.i(
          "PARALLAX_GL_ALPHA_PRECISION_VALIDATION "
              + (alphaPrecisionPassed ? "PASSED" : "FAILED"));
      listener.onEglReady(this);

      while (running) {
        boolean pending;
        synchronized (frameLock) {
          while (running && !framePending) {
            try {
              frameLock.wait();
            } catch (InterruptedException interrupted) {
              Thread.currentThread().interrupt();
              break;
            }
          }
          pending = framePending && running;
          framePending = false;
        }
        if (!pending) continue;

        ParallaxSensorState snapshot = sensorState;
        glRenderer.updateSensorState(snapshot.getX(), snapshot.getY());
        long frameStartNs = System.nanoTime();
        glRenderer.renderFrame();
        int glError = GLES20.glGetError();
        if (glError != GLES20.GL_NO_ERROR) {
          AppLog.e("PARALLAX_GL_RENDER_ERROR error=0x"
              + Integer.toHexString(glError)
              + " frame=" + totalGlFrames);
        }
        long swapStartNs = System.nanoTime();
        boolean swapSucceeded = EGL14.eglSwapBuffers(currentDisplay, currentSurface);
        long swapDurationNs = System.nanoTime() - swapStartNs;
        long frameDurationNs = System.nanoTime() - frameStartNs;
        recordGlFrame(frameDurationNs, swapDurationNs, swapSucceeded);
        if (!swapSucceeded) {
          AppLog.e("PARALLAX_EGL_SWAP_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
          reportFailure("egl_swap_buffers");
          break;
        }
      }
    } catch (Throwable error) {
      AppLog.e("PARALLAX_EGL_THREAD_FAILED", error);
      reportFailure("egl_thread_exception");
    } finally {
      if (glRenderer != null) {
        glRenderer.release();
        glRenderer = null;
      }
      emitGlMetricsIfNeeded(true);
      cleanupEgl(currentDisplay, currentContext, currentSurface);
       AppLog.i("PARALLAX_EGL_THREAD_CLEANUP_COMPLETE");
      listener.onEglThreadTerminated(this);
    }
  }

  private void reportFailure(String reason) {
    if (failureReported || !running) return;
    failureReported = true;
    synchronized (frameLock) {
      running = false;
      frameLock.notifyAll();
    }
    AppLog.e("PARALLAX_RENDERER_FALLBACK reason=" + reason);
    listener.onEglFailure(this, reason);
  }

  private void recordGlFrame(
      long frameDurationNs,
      long swapDurationNs,
      boolean swapSucceeded) {
    double frameTimeMs = frameDurationNs / 1000000.0;
    totalGlFrames += 1L;
    accumulatedDrawTimeNs += Math.max(0L, frameDurationNs);
    maxFrameTimeMs = Math.max(maxFrameTimeMs, frameTimeMs);

    if (frameDurationNs > VSYNC_BUDGET_NS) {
      droppedGlFrames += 1L;
      vsyncMisses += 1L;
    }

    long nowNs = System.nanoTime();
    if (metricsWindowStartedAtNs == 0L) metricsWindowStartedAtNs = nowNs;
    metricsWindowFrames += 1L;
    metricsWindowDrawTimeNs += Math.max(0L, frameDurationNs);
    metricsWindowMaxFrameTimeMs = Math.max(metricsWindowMaxFrameTimeMs, frameTimeMs);
    metricsWindowLastSwapMs = swapDurationNs / 1000000.0;
    metricsWindowLastSwapSucceeded = swapSucceeded;
    if (!swapSucceeded) metricsWindowSwapFailures += 1L;

    emitGlMetricsIfNeeded(false);
  }

  private void emitGlMetricsIfNeeded(boolean force) {
    if (metricsWindowFrames == 0L) {
      if (force && BuildConfig.DEBUG) {
        AppLog.i("PARALLAX_GPU_METRICS_EMPTY reason=no_frames_drawn"
            + " totalGlFrames=" + totalGlFrames
            + " vsyncMisses=" + vsyncMisses
            + " swapFailures=" + metricsWindowSwapFailures);
      }
      return;
    }
    long nowNs = System.nanoTime();
    long windowDurationNs = Math.max(1L, nowNs - metricsWindowStartedAtNs);
    if (!force
        && metricsWindowFrames < METRICS_FRAME_WINDOW
        && windowDurationNs < METRICS_TIME_WINDOW_NS) {
      return;
    }

    double averageRenderMs =
        metricsWindowDrawTimeNs / (double) metricsWindowFrames / 1000000.0;
    double averageFps = metricsWindowFrames * 1000000000.0 / windowDurationNs;
    String swapStatus = metricsWindowLastSwapSucceeded ? "OK" : "FAILED";
    AppLog.i(
        "PARALLAX_GPU_METRICS"
            + " averageFps=" + averageFps
            + " averageRenderMs=" + averageRenderMs
            + " maxRenderMs=" + metricsWindowMaxFrameTimeMs
            + " totalGlFrames=" + totalGlFrames
            + " droppedGlFrames=" + droppedGlFrames
            + " vsyncMisses=" + vsyncMisses
            + " swapStatus=" + swapStatus
            + " lastSwapMs=" + metricsWindowLastSwapMs
            + " swapFailures=" + metricsWindowSwapFailures
            + " accumulatedDrawTimeNs=" + accumulatedDrawTimeNs
            + " windowDrawnFrames=" + metricsWindowFrames);

    metricsWindowStartedAtNs = nowNs;
    metricsWindowFrames = 0L;
    metricsWindowDrawTimeNs = 0L;
    metricsWindowMaxFrameTimeMs = 0.0;
    metricsWindowSwapFailures = 0L;
    metricsWindowLastSwapMs = 0.0;
    metricsWindowLastSwapSucceeded = false;
    accumulatedDrawTimeNs = 0L;
    droppedGlFrames = 0L;
    vsyncMisses = 0L;
  }

  private EGLDisplay currentDisplay = EGL14.EGL_NO_DISPLAY;
  private EGLContext currentContext = EGL14.EGL_NO_CONTEXT;
  private EGLSurface currentSurface = EGL14.EGL_NO_SURFACE;

  private boolean initializeEgl() {
    if (surfaceHolder.getSurface() == null || !surfaceHolder.getSurface().isValid()) {
      AppLog.w("PARALLAX_EGL_INIT_SKIPPED_INVALID_SURFACE");
      return false;
    }

    currentDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
    if (currentDisplay == EGL14.EGL_NO_DISPLAY) {
      AppLog.e("PARALLAX_EGL_GET_DISPLAY_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }

    int[] version = new int[2];
    if (!EGL14.eglInitialize(currentDisplay, version, 0, version, 1)) {
      AppLog.e("PARALLAX_EGL_INITIALIZE_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }

    int[] configAttributes = {
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_NONE
    };
    EGLConfig[] configs = new EGLConfig[1];
    int[] configCount = new int[1];
    if (!EGL14.eglChooseConfig(
        currentDisplay,
        configAttributes,
        0,
        configs,
        0,
        configs.length,
        configCount,
        0)
        || configCount[0] == 0) {
      AppLog.e("PARALLAX_EGL_CHOOSE_CONFIG_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }

    int[] contextAttributes = {
      EGL14.EGL_CONTEXT_CLIENT_VERSION, 2,
      EGL14.EGL_NONE
    };
    currentContext = EGL14.eglCreateContext(
        currentDisplay,
        configs[0],
        EGL14.EGL_NO_CONTEXT,
        contextAttributes,
        0);
    if (currentContext == EGL14.EGL_NO_CONTEXT) {
      AppLog.e("PARALLAX_EGL_CREATE_CONTEXT_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }

    int[] surfaceAttributes = {EGL14.EGL_NONE};
    currentSurface = EGL14.eglCreateWindowSurface(
        currentDisplay,
        configs[0],
        surfaceHolder.getSurface(),
        surfaceAttributes,
        0);
    if (currentSurface == EGL14.EGL_NO_SURFACE) {
      AppLog.e("PARALLAX_EGL_CREATE_SURFACE_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }

    if (!EGL14.eglMakeCurrent(currentDisplay, currentSurface, currentSurface, currentContext)) {
      AppLog.e("PARALLAX_EGL_MAKE_CURRENT_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }
    if (!EGL14.eglSwapInterval(currentDisplay, 1)) {
      AppLog.e("PARALLAX_EGL_SWAP_INTERVAL_FAILED error=0x" + Integer.toHexString(EGL14.eglGetError()));
      return false;
    }
    AppLog.i("PARALLAX_EGL_READY");
    if (BuildConfig.DEBUG) {
      String extensions = EGL14.eglQueryString(currentDisplay, EGL14.EGL_EXTENSIONS);
      AppLog.i("PARALLAX_EGL_EXTENSIONS " + (extensions == null ? "(none)" : extensions));
    }
    return true;
  }

  private boolean initializeGlRenderer() {
    Rect surfaceFrame = surfaceHolder.getSurfaceFrame();
    int width = surfaceFrame == null ? 1 : Math.max(1, surfaceFrame.width());
    int height = surfaceFrame == null ? 1 : Math.max(1, surfaceFrame.height());
    glRenderer = new ParallaxGlRenderer(new ParallaxTextureManager(context));
    if (!glRenderer.initialize(width, height)) {
      AppLog.e("PARALLAX_GL_RENDERER_INIT_FAILED");
      return false;
    }
    return true;
  }

  private void cleanupEgl(
      EGLDisplay eglDisplay,
      EGLContext eglContext,
      EGLSurface eglSurface) {
    if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
      EGL14.eglMakeCurrent(
          eglDisplay,
          EGL14.EGL_NO_SURFACE,
          EGL14.EGL_NO_SURFACE,
          EGL14.EGL_NO_CONTEXT);
      if (eglSurface != EGL14.EGL_NO_SURFACE) {
        EGL14.eglDestroySurface(eglDisplay, eglSurface);
      }
      if (eglContext != EGL14.EGL_NO_CONTEXT) {
        EGL14.eglDestroyContext(eglDisplay, eglContext);
      }
      EGL14.eglTerminate(eglDisplay);
      EGL14.eglReleaseThread();
    }
    currentDisplay = EGL14.EGL_NO_DISPLAY;
    currentContext = EGL14.EGL_NO_CONTEXT;
    currentSurface = EGL14.EGL_NO_SURFACE;
    AppLog.i("PARALLAX_EGL_TERMINATED");
  }
}
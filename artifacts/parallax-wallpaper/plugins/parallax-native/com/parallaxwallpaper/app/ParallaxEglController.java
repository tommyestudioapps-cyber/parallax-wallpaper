package com.parallaxwallpaper.app;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.util.Log;
import android.view.SurfaceHolder;
import org.json.JSONObject;

public final class ParallaxEglController implements WallpaperRenderer, ParallaxEglThread.Listener {
  public interface FailureListener {
    void onGpuFailure(ParallaxEglController controller, String reason);
  }

  private enum State {
    STOPPED,
    STARTING,
    RUNNING,
    STOPPING
  }

  private static final String TAG = "ParallaxWallpaper";
  private static final String PREFS_NAME = ParallaxWallpaperService.PREFS_NAME;
  private static final String PREF_COMPOSITION = "composition";

  private final Context context;
  private final FailureListener failureListener;
  private final Object stateLock = new Object();
  private State state = State.STOPPED;
  private SurfaceHolder requestedSurface;
  private ParallaxEglThread eglThread;
  private volatile ParallaxSensorState sensorState = ParallaxSensorState.ZERO;
  private volatile ParallaxComposition composition;
  private volatile float intensity = 1f;
  private boolean visible;
  private boolean released;
  private boolean threadHadEglReady;
  private boolean failureReported;
  private boolean pendingReload;
  private int lastSurfaceWidth;
  private int lastSurfaceHeight;

  public ParallaxEglController(Context context, FailureListener failureListener) {
    this.context = context.getApplicationContext();
    this.failureListener = failureListener;
    refreshIntensityFromPrefs();
  }

  @Override
  public void onSurfaceCreated(SurfaceHolder holder) {
    updateRequestedSurface(holder, false);
  }

  @Override
  public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
    boolean sizeChanged;
    synchronized (stateLock) {
      sizeChanged = width != lastSurfaceWidth || height != lastSurfaceHeight;
      lastSurfaceWidth = width;
      lastSurfaceHeight = height;
    }
    updateRequestedSurface(holder, sizeChanged);
  }

  @Override
  public void onSurfaceDestroyed(SurfaceHolder holder) {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      if (requestedSurface == holder) requestedSurface = null;
      lastSurfaceWidth = 0;
      lastSurfaceHeight = 0;
      if (eglThread != null && state != State.STOPPING) {
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
  }

  @Override
  public void updateSensorState(ParallaxSensorState sensorState) {
    ParallaxSensorState nextState = sensorState == null
        ? ParallaxSensorState.ZERO
        : sensorState;
    ParallaxEglThread thread;
    synchronized (stateLock) {
      this.sensorState = nextState;
      thread = eglThread;
    }
    if (thread != null) thread.updateSensorState(nextState);
  }

  @Override
  public void setVisible(boolean visible) {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      this.visible = visible;
      if (!visible && eglThread != null && state != State.STOPPING) {
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
    if (visible) startIfPossible();
  }

  @Override
  public void setComposition(ParallaxComposition composition) {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      this.composition = composition;
      if (composition != null) {
        this.intensity = composition.getIntensity();
      }
      if (composition != null && eglThread != null && state != State.STOPPING) {
        pendingReload = true;
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
  }

  @Override
  public void renderFrame() {
    ParallaxEglThread thread;
    synchronized (stateLock) {
      thread = eglThread;
    }
    if (thread != null) thread.requestFrame();
  }

  @Override
  public void release() {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      released = true;
      visible = false;
      requestedSurface = null;
      composition = null;
      pendingReload = false;
      if (eglThread != null && state != State.STOPPING) {
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
  }

  @Override
  public void setForceDraw(boolean force) {
    if (!force) return;
    ParallaxEglThread thread;
    synchronized (stateLock) {
      thread = eglThread;
    }
    if (thread != null) thread.requestFrame();
  }

  @Override
  public void invalidateComposition() {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      refreshIntensityFromPrefs();
      pendingReload = true;
      if (eglThread != null && state != State.STOPPING) {
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
    startIfPossible();
  }

  @Override
  public void onTrimMemory(int level) {
    if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return;
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      pendingReload = true;
      if (eglThread != null && state != State.STOPPING) {
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    if (threadToStop != null) threadToStop.requestStop();
    Log.i(TAG, "PARALLAX_EGL_TRIM_MEMORY level=" + level);
  }

  @Override
  public float getIntensity() {
    return intensity;
  }

  @Override
  public void onEglReady(ParallaxEglThread thread) {
    synchronized (stateLock) {
      if (eglThread != thread) return;
      threadHadEglReady = true;
      if (state == State.STARTING) {
        state = State.RUNNING;
        Log.i(TAG, "PARALLAX_EGL_CONTROLLER_RUNNING");
      }
    }
  }

  @Override
  public void onEglFailure(ParallaxEglThread thread, String reason) {
    FailureListener callback;
    synchronized (stateLock) {
      if (eglThread != thread || released || failureReported) return;
      failureReported = true;
      pendingReload = false;
      state = State.STOPPING;
      callback = failureListener;
    }
    Log.e(TAG, "PARALLAX_RENDERER_FALLBACK reason=" + reason);
    if (callback != null) callback.onGpuFailure(this, reason);
    thread.requestStop();
  }

  @Override
  public void onEglThreadTerminated(ParallaxEglThread thread) {
    boolean restartAfterStop;
    synchronized (stateLock) {
      if (eglThread != thread) return;
      restartAfterStop =
          state == State.STOPPING
              && !failureReported
              && !released
              && (pendingReload || threadHadEglReady);
      eglThread = null;
      threadHadEglReady = false;
      pendingReload = false;
      state = State.STOPPED;
      Log.i(TAG, "PARALLAX_EGL_CONTROLLER_STOPPED");
    }
    if (restartAfterStop) startIfPossible();
  }

  private void updateRequestedSurface(SurfaceHolder holder, boolean sizeChanged) {
    ParallaxEglThread threadToStop = null;
    synchronized (stateLock) {
      SurfaceHolder previousSurface = requestedSurface;
      requestedSurface = holder;
      boolean surfaceReplaced = previousSurface != holder;
      if ((surfaceReplaced || sizeChanged)
          && eglThread != null
          && state != State.STOPPING) {
        pendingReload = true;
        state = State.STOPPING;
        threadToStop = eglThread;
      }
    }
    requestStop(threadToStop);
    startIfPossible();
  }

  private void startIfPossible() {
    synchronized (stateLock) {
      if (released || !visible || state != State.STOPPED || !isSurfaceValid(requestedSurface)) {
        return;
      }
      ParallaxEglThread nextThread = new ParallaxEglThread(requestedSurface, this, context);
      nextThread.updateSensorState(sensorState);
      eglThread = nextThread;
      threadHadEglReady = false;
      failureReported = false;
      state = State.STARTING;
      Log.i(TAG, "PARALLAX_EGL_CONTROLLER_STARTING");
      eglThread.start();
    }
  }

  private boolean isSurfaceValid(SurfaceHolder holder) {
    return holder != null
        && holder.getSurface() != null
        && holder.getSurface().isValid();
  }

  private void requestStop(ParallaxEglThread thread) {
    if (thread != null) thread.requestStop();
  }

  private void refreshIntensityFromPrefs() {
    try {
      String json = context
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .getString(PREF_COMPOSITION, null);
      if (json == null) {
        intensity = 1f;
        return;
      }
      JSONObject composition = new JSONObject(json);
      intensity = (float) composition.optDouble("intensity", 60) / 60f;
    } catch (Exception error) {
      intensity = 1f;
    }
  }
}
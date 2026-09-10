const fs = require('fs');
const path = require('path');

const javaRoot = path.resolve(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'parallaxwallpaper',
  'app',
);
const controller = fs.readFileSync(
  path.join(javaRoot, 'ParallaxEglController.java'),
  'utf8',
);
const eglThread = fs.readFileSync(path.join(javaRoot, 'ParallaxEglThread.java'), 'utf8');

function assertContains(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Missing EGL lifecycle guarantee: ${description}`);
  }
}

function assertOrder(source, patterns, description) {
  let previousIndex = -1;
  for (const pattern of patterns) {
    const index = source.search(pattern);
    if (index < 0 || index <= previousIndex) {
      throw new Error(`Invalid EGL cleanup order: ${description}`);
    }
    previousIndex = index;
  }
}

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start + signature.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing method boundaries for lifecycle check: ${signature}`);
  }
  return source.slice(start, end);
}

for (const state of ['STOPPED', 'STARTING', 'RUNNING', 'STOPPING']) {
  assertContains(controller, new RegExp(`\\b${state}\\b`), `FSM state ${state}`);
}

assertContains(controller, /state = State\.STOPPING/, 'surface transitions request STOPPING');
assertContains(controller, /thread\.requestStop\(\)/, 'stopping is asynchronous');
assertContains(controller, /state == State\.STOPPING/, 'restart is gated by STOPPING');
assertContains(controller, /threadHadEglReady && state == State\.STOPPING/, 'restart requires a completed EGL thread');
assertContains(controller, /state != State\.STOPPED/, 'new threads only start from STOPPED');
assertContains(controller, /isSurfaceValid\(requestedSurface\)/, 'surface validity is checked before start');
assertContains(controller, /released = true/, 'release marks the controller as released');

if (/Thread\.join|Thread\.sleep|sleep\s*\(/.test(controller)) {
  throw new Error('EGL controller must not block callbacks with join or sleep');
}

assertContains(eglThread, /if \(!EGL14\.eglSwapBuffers/, 'swap failure is checked');
assertContains(eglThread, /running = false/, 'swap failure stops the loop');
assertOrder(
  methodBody(eglThread, 'public void run()', 'private EGLDisplay currentDisplay'),
  [/initializeEgl\(\)/, /listener\.onEglReady\(this\)/],
  'the controller is notified only after EGL initialization',
);
assertOrder(
  methodBody(eglThread, 'public void run()', 'private EGLDisplay currentDisplay'),
  [/cleanupEgl\(/, /listener\.onEglThreadTerminated\(this\)/],
  'the controller is notified only after native cleanup',
);
assertOrder(
  methodBody(eglThread, 'private boolean initializeEgl()', 'private void cleanupEgl'),
  [/eglSwapInterval\(/, /PARALLAX_EGL_READY/],
  'EGL READY is logged after VSync configuration',
);
assertOrder(
  methodBody(eglThread, 'private void cleanupEgl(', '\n  }\n}'),
  [
    /eglMakeCurrent\(/,
    /eglDestroySurface\(/,
    /eglDestroyContext\(/,
    /eglTerminate\(/,
    /PARALLAX_EGL_TERMINATED/,
  ],
  'make current is released before surface, context, and display teardown',
);
assertOrder(
  methodBody(controller, 'public void onEglReady(ParallaxEglThread thread)', 'public void onEglThreadTerminated'),
  [/state = State\.RUNNING/, /PARALLAX_EGL_CONTROLLER_RUNNING/],
  'RUNNING is logged after the controller enters RUNNING',
);
assertOrder(
  methodBody(controller, 'public void onEglThreadTerminated(ParallaxEglThread thread)', 'private void updateRequestedSurface'),
  [/PARALLAX_EGL_CONTROLLER_STOPPED/, /startIfPossible\(\)/],
  'STOPPED is logged before a pending thread can start',
);
assertOrder(
  methodBody(controller, 'private void startIfPossible()', 'private boolean isSurfaceValid'),
  [/PARALLAX_EGL_CONTROLLER_STARTING/, /eglThread\.start\(\)/],
  'STARTING is logged before the EGL thread starts',
);

console.log('EGL lifecycle static regression checks passed');
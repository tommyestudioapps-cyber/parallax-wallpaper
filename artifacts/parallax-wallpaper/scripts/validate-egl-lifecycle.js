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
  eglThread,
  [
    /eglMakeCurrent\(/,
    /eglDestroySurface\(/,
    /eglDestroyContext\(/,
    /eglTerminate\(/,
  ],
  'make current is released before surface, context, and display teardown',
);
assertContains(eglThread, /listener\.onEglThreadTerminated\(this\)/, 'termination is reported after cleanup');

console.log('EGL lifecycle static regression checks passed');
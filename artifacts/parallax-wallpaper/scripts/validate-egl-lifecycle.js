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
const textureManager = fs.readFileSync(
  path.join(javaRoot, 'ParallaxTextureManager.java'),
  'utf8',
);
const glRenderer = fs.readFileSync(path.join(javaRoot, 'ParallaxGlRenderer.java'), 'utf8');

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
assertContains(eglThread, /new ParallaxGlRenderer/, 'EGL thread owns the GL renderer');
assertContains(eglThread, /initializeGlRenderer\(\)/, 'GL renderer initializes after EGL');
assertContains(eglThread, /glRenderer\.renderFrame\(\)/, 'EGL loop delegates frame rendering');
assertContains(eglThread, /glRenderer\.release\(\)/, 'GL resources release before EGL teardown');
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

assertContains(textureManager, /GLES20\.glGenTextures/, 'textures are generated on GL');
assertContains(textureManager, /GLUtils\.texImage2D/, 'bitmaps upload through GLUtils');
assertContains(textureManager, /GLES20\.GL_LINEAR/, 'linear texture filtering is configured');
assertContains(textureManager, /GLES20\.GL_CLAMP_TO_EDGE/, 'edge wrapping is configured');
assertContains(textureManager, /GLES20\.glDeleteTextures/, 'textures are deleted');
assertContains(textureManager, /if \(backgroundTextureId != 0\)/, 'texture upload is guarded per context');
assertContains(textureManager, /BitmapFactory\.decode/, 'background bitmap loading is isolated from the frame loop');

assertContains(glRenderer, /glCreateShader/, 'vertex and fragment shaders are compiled');
assertContains(glRenderer, /glGenBuffers/, 'fullscreen quad uses a VBO');
assertContains(glRenderer, /glBufferData/, 'quad data uploads once to the VBO');
assertContains(glRenderer, /glDrawArrays/, 'fullscreen quad is rendered');
assertContains(glRenderer, /texture2D/, 'fragment shader samples the texture');
if (/BitmapFactory|new\s+/.test(methodBody(glRenderer, 'public void renderFrame()', 'public void release()'))) {
  throw new Error('GL renderFrame must not decode bitmaps or allocate objects');
}

console.log('EGL lifecycle static regression checks passed');
package com.parallaxwallpaper.app;

import android.opengl.GLES20;
import android.opengl.Matrix;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

public final class ParallaxGlRenderer {
  private static final String TAG = "ParallaxWallpaper";
  private static final float ALPHA_TOLERANCE = 0.0000005f;
  private static final float FRAMEBUFFER_ALPHA_HALF_LSB = 0.5f / 255f;

  private static final AlphaPrecisionCase[] ALPHA_PRECISION_CASES = {
    new AlphaPrecisionCase(
        "transparent-zero",
        "center",
        0f, 0f, 0f, 0f,
        0f, 0f, 0f, 0f),
    new AlphaPrecisionCase(
        "alpha-lsb-over-transparent",
        "center",
        0f, 0f, 0f, 1f / 255f,
        0f, 0f, 0f, 0f),
    new AlphaPrecisionCase(
        "alpha-lsb-over-opaque",
        "center",
        0f, 0f, 0f, 1f / 255f,
        0f, 0f, 0f, 1f),
    new AlphaPrecisionCase(
        "half-alpha-over-quarter-alpha",
        "center",
        0f, 0f, 0f, 128f / 255f,
        0f, 0f, 0f, 64f / 255f)
  };

  private static final String VERTEX_SHADER =
      "attribute vec2 a_Position;\n"
          + "attribute vec2 a_TexCoord;\n"
          + "uniform mat4 u_MVPMatrix;\n"
          + "uniform vec2 u_Offset;\n"
          + "uniform float u_DepthFactor;\n"
          + "varying vec2 v_TexCoord;\n"
          + "void main() {\n"
          + "  vec4 displacedPosition = vec4(a_Position, 0.0, 1.0)\n"
          + "      + vec4(u_Offset * u_DepthFactor, 0.0, 0.0);\n"
          + "  gl_Position = u_MVPMatrix * displacedPosition;\n"
          + "  v_TexCoord = a_TexCoord;\n"
          + "}\n";

  private static final String FRAGMENT_SHADER =
      "precision mediump float;\n"
          + "uniform sampler2D u_Texture;\n"
          + "varying vec2 v_TexCoord;\n"
          + "void main() {\n"
          + "  gl_FragColor = texture2D(u_Texture, v_TexCoord);\n"
          + "}\n";

  private static final float[] QUAD_DATA = {
    -1f, -1f, 0f, 1f,
     1f, -1f, 1f, 1f,
    -1f,  1f, 0f, 0f,
     1f,  1f, 1f, 0f
  };

  private final ParallaxTextureManager textureManager;
  private final FloatBuffer quadBuffer;
  private final float[] mMVPMatrix = new float[16];
  private final float[] mProjMatrix = new float[16];
  private final float[] mModelMatrix = new float[16];
  private int[] textureIds;
  private int program;
  private int positionLocation;
  private int texCoordLocation;
  private int textureLocation;
  private int mvpMatrixLocation;
  private int offsetLocation;
  private int depthFactorLocation;
  private int vertexBuffer;
  private int surfaceWidth;
  private int surfaceHeight;
  private float motionX;
  private float motionY;

  public ParallaxGlRenderer(ParallaxTextureManager textureManager) {
    this.textureManager = textureManager;
    quadBuffer = ByteBuffer
        .allocateDirect(QUAD_DATA.length * Float.BYTES)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer();
    quadBuffer.put(QUAD_DATA).position(0);
  }

  public boolean initialize(int surfaceWidth, int surfaceHeight) {
    this.surfaceWidth = Math.max(1, surfaceWidth);
    this.surfaceHeight = Math.max(1, surfaceHeight);
    Matrix.orthoM(mProjMatrix, 0, -1f, 1f, -1f, 1f, -1f, 1f);
    GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight);
    int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
    int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (vertexShader == 0 || fragmentShader == 0) {
      if (vertexShader != 0) GLES20.glDeleteShader(vertexShader);
      if (fragmentShader != 0) GLES20.glDeleteShader(fragmentShader);
      return false;
    }

    program = GLES20.glCreateProgram();
    if (program == 0) {
      GLES20.glDeleteShader(vertexShader);
      GLES20.glDeleteShader(fragmentShader);
      Log.e(TAG, "PARALLAX_GL_PROGRAM_CREATE_FAILED");
      return false;
    }
    GLES20.glAttachShader(program, vertexShader);
    GLES20.glAttachShader(program, fragmentShader);
    GLES20.glLinkProgram(program);
    int[] linkStatus = new int[1];
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0);
    GLES20.glDeleteShader(vertexShader);
    GLES20.glDeleteShader(fragmentShader);
    if (linkStatus[0] == 0) {
      Log.e(TAG, "PARALLAX_GL_PROGRAM_LINK_FAILED " + GLES20.glGetProgramInfoLog(program));
      release();
      return false;
    }

    positionLocation = GLES20.glGetAttribLocation(program, "a_Position");
    texCoordLocation = GLES20.glGetAttribLocation(program, "a_TexCoord");
    textureLocation = GLES20.glGetUniformLocation(program, "u_Texture");
    mvpMatrixLocation = GLES20.glGetUniformLocation(program, "u_MVPMatrix");
    offsetLocation = GLES20.glGetUniformLocation(program, "u_Offset");
    depthFactorLocation = GLES20.glGetUniformLocation(program, "u_DepthFactor");
    if (positionLocation < 0
        || texCoordLocation < 0
        || textureLocation < 0
        || mvpMatrixLocation < 0
        || offsetLocation < 0
        || depthFactorLocation < 0) {
      Log.e(TAG, "PARALLAX_GL_SHADER_LOCATION_FAILED");
      release();
      return false;
    }

    int[] buffers = new int[1];
    GLES20.glGenBuffers(1, buffers, 0);
    vertexBuffer = buffers[0];
    if (vertexBuffer == 0) {
      Log.e(TAG, "PARALLAX_GL_VBO_CREATE_FAILED");
      release();
      return false;
    }
    GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vertexBuffer);
    quadBuffer.position(0);
    GLES20.glBufferData(
        GLES20.GL_ARRAY_BUFFER,
        QUAD_DATA.length * Float.BYTES,
        quadBuffer,
        GLES20.GL_STATIC_DRAW);
    GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);

    textureIds = textureManager.loadTextures(surfaceWidth, surfaceHeight);
    if (textureIds[0] == 0) {
      Log.w(TAG, "PARALLAX_GL_BACKGROUND_TEXTURE_UNAVAILABLE");
    }
    GLES20.glEnable(GLES20.GL_BLEND);
    GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA);
    GLES20.glClearColor(0f, 0f, 0f, 1f);
    Log.i(TAG,
        "PARALLAX_GL_RENDERER_READY"
            + " background=" + textureIds[0]
            + " middle=" + textureIds[1]
            + " foreground=" + textureIds[2]);
    return true;
  }

  public void renderFrame() {
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
    if (program == 0 || vertexBuffer == 0 || textureIds == null) return;

    GLES20.glUseProgram(program);

    GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vertexBuffer);
    GLES20.glEnableVertexAttribArray(positionLocation);
    GLES20.glVertexAttribPointer(
        positionLocation,
        2,
        GLES20.GL_FLOAT,
        false,
        4 * Float.BYTES,
        0);
    GLES20.glEnableVertexAttribArray(texCoordLocation);
    GLES20.glVertexAttribPointer(
        texCoordLocation,
        2,
        GLES20.GL_FLOAT,
        false,
        4 * Float.BYTES,
        2 * Float.BYTES);
    for (int index = 0; index < textureIds.length; index += 1) {
      int textureId = textureIds[index];
      if (textureId == 0) continue;
      updateLayerMvp(index);
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
      GLES20.glUniform1i(textureLocation, 0);
      GLES20.glUniform2f(offsetLocation, motionX, motionY);
      GLES20.glUniform1f(depthFactorLocation, textureManager.getDepthFactor(index));
      GLES20.glUniformMatrix4fv(mvpMatrixLocation, 1, false, mMVPMatrix, 0);
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }
    GLES20.glDisableVertexAttribArray(positionLocation);
    GLES20.glDisableVertexAttribArray(texCoordLocation);
    GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
  }

  public boolean validateAlphaPrecision() {
    if (program == 0 || vertexBuffer == 0) {
      Log.e(TAG, "PARALLAX_GL_ALPHA_PRECISION_FAILED"
          + " case=renderer-not-ready position=none clearColor=none alpha=unavailable");
      return false;
    }

    int[] framebuffer = new int[1];
    int[] framebufferTexture = new int[1];
    int[] sourceTexture = new int[1];
    ByteBuffer sourcePixels = ByteBuffer
        .allocateDirect(4)
        .order(ByteOrder.nativeOrder());
    ByteBuffer observedPixels = ByteBuffer
        .allocateDirect(4)
        .order(ByteOrder.nativeOrder());
    boolean passed = true;

    GLES20.glGenFramebuffers(1, framebuffer, 0);
    GLES20.glGenTextures(1, framebufferTexture, 0);
    GLES20.glGenTextures(1, sourceTexture, 0);
    if (framebuffer[0] == 0 || framebufferTexture[0] == 0 || sourceTexture[0] == 0) {
      Log.e(TAG, "PARALLAX_GL_ALPHA_PRECISION_FAILED"
          + " case=resource-allocation position=none clearColor=none alpha=unavailable");
      deleteAlphaPrecisionResources(framebuffer, framebufferTexture, sourceTexture);
      return false;
    }

    try {
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer[0]);
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, framebufferTexture[0]);
      configureAlphaPrecisionTexture();
      GLES20.glTexImage2D(
          GLES20.GL_TEXTURE_2D,
          0,
          GLES20.GL_RGBA,
          1,
          1,
          0,
          GLES20.GL_RGBA,
          GLES20.GL_UNSIGNED_BYTE,
          null);
      GLES20.glFramebufferTexture2D(
          GLES20.GL_FRAMEBUFFER,
          GLES20.GL_COLOR_ATTACHMENT0,
          GLES20.GL_TEXTURE_2D,
          framebufferTexture[0],
          0);
      if (GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER)
          != GLES20.GL_FRAMEBUFFER_COMPLETE) {
        Log.e(TAG, "PARALLAX_GL_ALPHA_PRECISION_FAILED"
            + " case=framebuffer-incomplete position=none clearColor=none alpha=unavailable");
        return false;
      }

      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, sourceTexture[0]);
      configureAlphaPrecisionTexture();
      GLES20.glUseProgram(program);
      GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vertexBuffer);
      GLES20.glEnableVertexAttribArray(positionLocation);
      GLES20.glVertexAttribPointer(
          positionLocation,
          2,
          GLES20.GL_FLOAT,
          false,
          4 * Float.BYTES,
          0);
      GLES20.glEnableVertexAttribArray(texCoordLocation);
      GLES20.glVertexAttribPointer(
          texCoordLocation,
          2,
          GLES20.GL_FLOAT,
          false,
          4 * Float.BYTES,
          2 * Float.BYTES);
      GLES20.glUniform1i(textureLocation, 0);
      GLES20.glUniform2f(offsetLocation, 0f, 0f);
      GLES20.glUniform1f(depthFactorLocation, 0f);
      GLES20.glUniformMatrix4fv(mvpMatrixLocation, 1, false, mMVPMatrix, 0);
      GLES20.glViewport(0, 0, 1, 1);
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0);

      for (AlphaPrecisionCase testCase : ALPHA_PRECISION_CASES) {
        sourcePixels.position(0);
        sourcePixels.put(testCase.sourceRgbaBytes()).position(0);
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            GLES20.GL_RGBA,
            1,
            1,
            0,
            GLES20.GL_RGBA,
            GLES20.GL_UNSIGNED_BYTE,
            sourcePixels);
        GLES20.glClearColor(
            testCase.clearRed,
            testCase.clearGreen,
            testCase.clearBlue,
            testCase.clearAlpha);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glFinish();

        observedPixels.position(0);
        GLES20.glReadPixels(
            0,
            0,
            1,
            1,
            GLES20.GL_RGBA,
            GLES20.GL_UNSIGNED_BYTE,
            observedPixels);
        observedPixels.position(0);
        int alphaByte = observedPixels.get(3) & 0xff;
        float observedAlpha = alphaByte / 255f;
        float expectedAlpha = testCase.expectedAlpha();
        float alphaError = Math.abs(observedAlpha - expectedAlpha);
        float alphaTolerance = Math.max(ALPHA_TOLERANCE, FRAMEBUFFER_ALPHA_HALF_LSB);
        if (alphaError > alphaTolerance) {
          Log.e(TAG, "PARALLAX_GL_ALPHA_PRECISION_FAILED"
              + " case=" + testCase.name
              + " position=" + testCase.position
              + " clearColor=" + testCase.clearColorDescription()
              + " alpha=" + observedAlpha
              + " expectedAlpha=" + expectedAlpha
              + " tolerance=" + alphaTolerance
              + " policyAlphaTolerance=" + ALPHA_TOLERANCE);
          passed = false;
        }
      }
      return passed;
    } finally {
      GLES20.glDisableVertexAttribArray(positionLocation);
      GLES20.glDisableVertexAttribArray(texCoordLocation);
      GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
      GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight);
      GLES20.glClearColor(0f, 0f, 0f, 1f);
      deleteAlphaPrecisionResources(framebuffer, framebufferTexture, sourceTexture);
    }
  }

  public void release() {
    textureManager.releaseTextures();
    if (program != 0) {
      GLES20.glDeleteProgram(program);
      program = 0;
    }
    if (vertexBuffer != 0) {
      int[] buffers = {vertexBuffer};
      GLES20.glDeleteBuffers(1, buffers, 0);
      vertexBuffer = 0;
    }
    textureIds = null;
  }

  public void updateSensorState(float sensorMotionX, float sensorMotionY) {
    motionX = sensorMotionX * 2f / surfaceWidth;
    motionY = sensorMotionY * 2f / surfaceHeight;
  }

  private void configureAlphaPrecisionTexture() {
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_MIN_FILTER,
        GLES20.GL_NEAREST);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_MAG_FILTER,
        GLES20.GL_NEAREST);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_WRAP_S,
        GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(
        GLES20.GL_TEXTURE_2D,
        GLES20.GL_TEXTURE_WRAP_T,
        GLES20.GL_CLAMP_TO_EDGE);
  }

  private void deleteAlphaPrecisionResources(
      int[] framebuffer,
      int[] framebufferTexture,
      int[] sourceTexture) {
    if (framebuffer[0] != 0) {
      GLES20.glDeleteFramebuffers(1, framebuffer, 0);
    }
    if (framebufferTexture[0] != 0) {
      GLES20.glDeleteTextures(1, framebufferTexture, 0);
    }
    if (sourceTexture[0] != 0) {
      GLES20.glDeleteTextures(1, sourceTexture, 0);
    }
  }

  private static final class AlphaPrecisionCase {
    private final String name;
    private final String position;
    private final float sourceRed;
    private final float sourceGreen;
    private final float sourceBlue;
    private final float sourceAlpha;
    private final float clearRed;
    private final float clearGreen;
    private final float clearBlue;
    private final float clearAlpha;

    private AlphaPrecisionCase(
        String name,
        String position,
        float sourceRed,
        float sourceGreen,
        float sourceBlue,
        float sourceAlpha,
        float clearRed,
        float clearGreen,
        float clearBlue,
        float clearAlpha) {
      this.name = name;
      this.position = position;
      this.sourceRed = sourceRed;
      this.sourceGreen = sourceGreen;
      this.sourceBlue = sourceBlue;
      this.sourceAlpha = sourceAlpha;
      this.clearRed = clearRed;
      this.clearGreen = clearGreen;
      this.clearBlue = clearBlue;
      this.clearAlpha = clearAlpha;
    }

    private byte[] sourceRgbaBytes() {
      return new byte[] {
        (byte) Math.round(sourceRed * 255f),
        (byte) Math.round(sourceGreen * 255f),
        (byte) Math.round(sourceBlue * 255f),
        (byte) Math.round(sourceAlpha * 255f)
      };
    }

    private float expectedAlpha() {
      return sourceAlpha + clearAlpha * (1f - sourceAlpha);
    }

    private String clearColorDescription() {
      return clearRed + "," + clearGreen + "," + clearBlue + "," + clearAlpha;
    }
  }

  private void updateLayerMvp(int index) {
    int textureWidth = textureManager.getTextureWidth(index);
    int textureHeight = textureManager.getTextureHeight(index);
    if (textureWidth <= 0 || textureHeight <= 0) {
      Matrix.setIdentityM(mMVPMatrix, 0);
      return;
    }

    float fitScale = Math.max(
        surfaceWidth / (float) textureWidth,
        surfaceHeight / (float) textureHeight);
    float scaledWidth = textureWidth * fitScale;
    float scaledHeight = textureHeight * fitScale;
    float scaleX = scaledWidth / surfaceWidth;
    float scaleY = scaledHeight / surfaceHeight;

    Matrix.setIdentityM(mModelMatrix, 0);
    Matrix.scaleM(mModelMatrix, 0, scaleX, scaleY, 1f);
    Matrix.multiplyMM(mMVPMatrix, 0, mProjMatrix, 0, mModelMatrix, 0);
  }

  private int compileShader(int type, String source) {
    int shader = GLES20.glCreateShader(type);
    if (shader == 0) {
      Log.e(TAG, "PARALLAX_GL_SHADER_CREATE_FAILED type=" + type);
      return 0;
    }
    GLES20.glShaderSource(shader, source);
    GLES20.glCompileShader(shader);
    int[] compileStatus = new int[1];
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compileStatus, 0);
    if (compileStatus[0] == 0) {
      Log.e(TAG, "PARALLAX_GL_SHADER_COMPILE_FAILED " + GLES20.glGetShaderInfoLog(shader));
      GLES20.glDeleteShader(shader);
      return 0;
    }
    return shader;
  }
}
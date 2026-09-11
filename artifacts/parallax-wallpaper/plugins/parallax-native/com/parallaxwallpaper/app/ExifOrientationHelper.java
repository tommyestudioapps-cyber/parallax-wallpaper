package com.parallaxwallpaper.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.net.Uri;
import androidx.exifinterface.media.ExifInterface;
import java.io.InputStream;

final class ExifOrientationHelper {
  private static final String TAG = "ParallaxWallpaper";

  private ExifOrientationHelper() {}

  static Bitmap applyOrientation(Context context, Bitmap bitmap, String uriString, int layerIndex) {
    if (bitmap == null || bitmap.isRecycled()) return bitmap;
    int orientation = readOrientation(context, uriString);
    if (orientation == ExifInterface.ORIENTATION_NORMAL
        || orientation == ExifInterface.ORIENTATION_UNDEFINED) {
      return bitmap;
    }

    Matrix matrix = new Matrix();
    switch (orientation) {
      case ExifInterface.ORIENTATION_ROTATE_90:
        matrix.postRotate(90f);
        break;
      case ExifInterface.ORIENTATION_ROTATE_180:
        matrix.postRotate(180f);
        break;
      case ExifInterface.ORIENTATION_ROTATE_270:
        matrix.postRotate(270f);
        break;
      case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
        matrix.postScale(-1f, 1f);
        break;
      case ExifInterface.ORIENTATION_FLIP_VERTICAL:
        matrix.postScale(1f, -1f);
        break;
      case ExifInterface.ORIENTATION_TRANSPOSE:
        matrix.postRotate(90f);
        matrix.postScale(-1f, 1f);
        break;
      case ExifInterface.ORIENTATION_TRANSVERSE:
        matrix.postRotate(270f);
        matrix.postScale(-1f, 1f);
        break;
      default:
        return bitmap;
    }

    try {
      Bitmap rotated = Bitmap.createBitmap(
          bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
      if (rotated != bitmap) {
        bitmap.recycle();
      }
      AppLog.i(
          "PARALLAX_EXIF_APPLIED index=" + layerIndex
              + " orientation=" + orientation
              + " width=" + rotated.getWidth()
              + " height=" + rotated.getHeight());
      return rotated;
    } catch (Exception error) {
      AppLog.e("PARALLAX_EXIF_APPLY_FAILED index=" + layerIndex, error);
      return bitmap;
    }
  }

  private static int readOrientation(Context context, String uriString) {
    try {
      Uri uri = Uri.parse(uriString);
      if ("content".equals(uri.getScheme())) {
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
          if (stream == null) return ExifInterface.ORIENTATION_NORMAL;
          ExifInterface exif = new ExifInterface(stream);
          return exif.getAttributeInt(
              ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        }
      }
      ExifInterface exif = new ExifInterface(uriString);
      return exif.getAttributeInt(
          ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
    } catch (Exception error) {
      return ExifInterface.ORIENTATION_NORMAL;
    }
  }
}
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'com.parallaxwallpaper.app';
const JAVA_PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, '/');

const CANONICAL_JAVA_DIRECTORY = path.resolve(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'main',
  'java',
  JAVA_PACKAGE_PATH,
);
const CANONICAL_JAVA_FILES = [
  'ParallaxWallpaperService.java',
  'WallpaperRenderer.java',
  'CanvasWallpaperRenderer.java',
  'ParallaxComposition.java',
  'ParallaxSensorState.java',
  'ParallaxEglThread.java',
  'ParallaxEglController.java',
];

function withParallaxWallpaperManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('Parallax wallpaper plugin could not find the Android application node.');
    }

    application.service = application.service || [];
    const alreadyRegistered = application.service.some(
      (service) => service.$?.['android:name'] === '.ParallaxWallpaperService',
    );

    if (!alreadyRegistered) {
      application.service.push({
        $: {
          'android:name': '.ParallaxWallpaperService',
          'android:label': 'Parallax Wallpaper',
          'android:permission': 'android.permission.BIND_WALLPAPER',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.wallpaper.WallpaperService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.service.wallpaper',
              'android:resource': '@xml/parallax_wallpaper',
            },
          },
        ],
      });
    }

    return modConfig;
  });
}

function withParallaxWallpaperMainApplication(config) {
  return withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('ParallaxWallpaperPackage')) {
      contents = contents.replace(
        /^(package [^\n]+\n)/m,
        `$1\nimport ${PACKAGE_NAME}.ParallaxWallpaperPackage\n`,
      );
    }

    if (contents.includes('add(ParallaxWallpaperPackage())')) {
      // The generated native project already contains the package registration.
    } else if (contents.includes('PackageList(this).packages.apply {')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(ParallaxWallpaperPackage())\n',
      );
    } else if (contents.includes('PackageList(this).packages')) {
      contents = contents.replace(
        'val packages = PackageList(this).packages',
        'val packages = PackageList(this).packages\n    packages.add(ParallaxWallpaperPackage())',
      );
    } else if (contents.includes('PackageList(this).getPackages()')) {
      contents = contents.replace(
        'List<ReactPackage> packages = new PackageList(this).getPackages();',
        'List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ParallaxWallpaperPackage());',
      );
    } else {
      throw new Error('Parallax wallpaper plugin could not find the React Native package list.');
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

function withParallaxWallpaperFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const androidRoot = path.join(modConfig.modRequest.platformProjectRoot);
      const javaDirectory = path.join(androidRoot, 'app', 'src', 'main', 'java', JAVA_PACKAGE_PATH);
      const xmlDirectory = path.join(androidRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(javaDirectory, { recursive: true });
      fs.mkdirSync(xmlDirectory, { recursive: true });

      for (const fileName of CANONICAL_JAVA_FILES) {
        const canonicalPath = path.join(CANONICAL_JAVA_DIRECTORY, fileName);
        if (!fs.existsSync(canonicalPath)) {
          throw new Error(`Canonical ${fileName} was not found at ${canonicalPath}`);
        }

        let canonicalJava;
        try {
          canonicalJava = fs.readFileSync(canonicalPath, 'utf8');
        } catch (error) {
          throw new Error(`Failed to read canonical ${fileName} at ${canonicalPath}`, {
            cause: error,
          });
        }
        fs.writeFileSync(path.join(javaDirectory, fileName), canonicalJava, 'utf8');
      }

      fs.writeFileSync(path.join(javaDirectory, 'ParallaxWallpaperPackage.java'), PARALLAX_PACKAGE_JAVA);
      fs.writeFileSync(path.join(javaDirectory, 'ParallaxWallpaperModule.java'), PARALLAX_MODULE_JAVA);
      fs.writeFileSync(path.join(xmlDirectory, 'parallax_wallpaper.xml'), PARALLAX_XML);
      return modConfig;
    },
  ]);
}

const PARALLAX_PACKAGE_JAVA = `package ${PACKAGE_NAME};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ParallaxWallpaperPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new ParallaxWallpaperModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;

const PARALLAX_MODULE_JAVA = `package ${PACKAGE_NAME};

import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class ParallaxWallpaperModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  public ParallaxWallpaperModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "ParallaxWallpaper";
  }

  @ReactMethod
  public void configureLiveWallpaper(String configJson, Promise promise) {
    try {
      reactContext
          .getSharedPreferences("parallax_wallpaper", Context.MODE_PRIVATE)
          .edit()
          .putString("composition", configJson)
          .apply();
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("CONFIGURE_WALLPAPER_FAILED", error);
    }
  }

  @ReactMethod
  public void openLiveWallpaperChooser(Promise promise) {
    try {
      Intent intent = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
      intent.putExtra(
          WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
          new ComponentName(reactContext, ParallaxWallpaperService.class)
      );
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception error) {
      promise.reject("OPEN_WALLPAPER_CHOOSER_FAILED", error);
    }
  }
}
`;

const PARALLAX_XML = `<wallpaper xmlns:android="http://schemas.android.com/apk/res/android" />\n`;

module.exports = function withParallaxLiveWallpaper(config) {
  config = withParallaxWallpaperManifest(config);
  config = withParallaxWallpaperMainApplication(config);
  config = withParallaxWallpaperFiles(config);
  return config;
};
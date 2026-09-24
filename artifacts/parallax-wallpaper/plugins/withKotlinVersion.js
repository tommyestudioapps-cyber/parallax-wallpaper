const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// Workaround: expo-build-properties writes android.kotlinVersion to
// gradle.properties, but the Kotlin Gradle Plugin in this setup (Expo SDK 54
// + RN 0.81) ignores the property. Inject the version directly into classpath.
// Remove this once the ecosystem consumes the property correctly.
const KOTLIN_VERSION = '2.2.0';

module.exports = function withKotlinVersion(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        'build.gradle',
      );
      if (!fs.existsSync(buildGradlePath)) {
        throw new Error(
          'withKotlinVersion: android/build.gradle não encontrado',
        );
      }
      let content = fs.readFileSync(buildGradlePath, 'utf8');

      // Replace the classpath line without a version with an explicit version.
      const before =
        /classpath\((['"])org\.jetbrains\.kotlin:kotlin-gradle-plugin\1\)/;
      const after = `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}')`;
      if (!before.test(content)) {
        throw new Error(
          'withKotlinVersion: classpath do kotlin-gradle-plugin não encontrado em build.gradle',
        );
      }
      content = content.replace(before, after);
      fs.writeFileSync(buildGradlePath, content);

      // Sanity check that the explicit version was written.
      if (!content.includes(`kotlin-gradle-plugin:${KOTLIN_VERSION}`)) {
        throw new Error('withKotlinVersion: injeção falhou');
      }
      return config;
    },
  ]);
};
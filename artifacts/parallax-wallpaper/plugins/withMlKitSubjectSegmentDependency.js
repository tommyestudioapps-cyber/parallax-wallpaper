const { withAndroidManifest } = require("@expo/config-plugins");

const ML_KIT_DEPENDENCIES = "com.google.mlkit.vision.DEPENDENCIES";
const SUBJECT_SEGMENT = "subject_segment";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";

module.exports = function withMlKitSubjectSegmentDependency(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    const application = manifest.application?.[0];

    if (!application) {
      throw new Error(
        "Unable to configure ML Kit dependencies: Android application manifest entry is missing.",
      );
    }

    manifest.$ = {
      ...(manifest.$ ?? {}),
      "xmlns:tools": TOOLS_NAMESPACE,
    };

    const metadata = application["meta-data"] ?? [];
    const dependencyMetadata = metadata.find(
      (entry) => entry.$?.["android:name"] === ML_KIT_DEPENDENCIES,
    );

    if (dependencyMetadata) {
      dependencyMetadata.$ = {
        ...(dependencyMetadata.$ ?? {}),
        "android:value": SUBJECT_SEGMENT,
        "tools:replace": "android:value",
      };
    } else {
      metadata.push({
        $: {
          "android:name": ML_KIT_DEPENDENCIES,
          "android:value": SUBJECT_SEGMENT,
          "tools:replace": "android:value",
        },
      });
    }

    application["meta-data"] = metadata;
    return configWithManifest;
  });
};
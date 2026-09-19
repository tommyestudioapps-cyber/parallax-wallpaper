const { withGradleProperties } = require('@expo/config-plugins');

const GRADLE_PROPERTIES = {
  'org.gradle.jvmargs':
    '-Xmx3072m -XX:MaxMetaspaceSize=512m -Djava.util.concurrent.ForkJoinPool.common.parallelism=2',
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '2',
};

module.exports = function withGradleBuildMemory(config) {
  return withGradleProperties(config, (configWithProperties) => {
    const properties = configWithProperties.modResults;

    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      const existing = properties.find(
        (property) => property.type === 'property' && property.key === key,
      );

      if (existing) {
        existing.value = value;
      } else {
        properties.push({ type: 'property', key, value });
      }
    }

    return configWithProperties;
  });
};
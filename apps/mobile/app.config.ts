import type { ConfigContext, ExpoConfig } from 'expo/config';

function readMapLibreStyleUrl(): string {
  const styleUrl = process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL?.trim();
  if (styleUrl && styleUrl.length > 0) {
    return styleUrl;
  }
  return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapLibreStyleUrl = readMapLibreStyleUrl();
  const baseConfig: ExpoConfig = {
    ...config,
    name: config.name ?? 'Underchat',
    slug: config.slug ?? 'underchat',
    version: config.version ?? '1.0.0',
  };

  const plugins = Array.isArray(baseConfig.plugins)
    ? [...baseConfig.plugins]
    : [];
  if (!plugins.includes('expo-image')) {
    plugins.push('expo-image');
  }
  const videoTrimSupportPlugin = './plugins/withVideoTrimSupportModule';
  const hasVideoTrimSupportPlugin = plugins.some((plugin) => {
    if (typeof plugin === 'string') {
      return plugin === videoTrimSupportPlugin;
    }
    return Array.isArray(plugin) && plugin[0] === videoTrimSupportPlugin;
  });
  if (!hasVideoTrimSupportPlugin) {
    plugins.push(videoTrimSupportPlugin);
  }

  return {
    ...baseConfig,
    plugins,
    extra: {
      ...(baseConfig.extra ?? {}),
      mapLibreStyleUrl,
    },
  };
};

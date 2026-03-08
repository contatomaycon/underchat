import type { ExpoConfig } from 'expo/config';

const appJson = require('./app.json') as { expo: ExpoConfig };

function readMapLibreStyleUrl(): string {
  const styleUrl = process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL?.trim();
  if (styleUrl && styleUrl.length > 0) {
    return styleUrl;
  }
  return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
}

export default (): ExpoConfig => {
  const mapLibreStyleUrl = readMapLibreStyleUrl();
  const baseConfig = appJson.expo;

  const plugins = Array.isArray(baseConfig.plugins)
    ? [...baseConfig.plugins]
    : [];
  if (!plugins.includes('expo-image')) {
    plugins.push('expo-image');
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

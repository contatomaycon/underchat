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

  return {
    ...baseConfig,
    extra: {
      ...(baseConfig.extra ?? {}),
      mapLibreStyleUrl,
    },
  };
};

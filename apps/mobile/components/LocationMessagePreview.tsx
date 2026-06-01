import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  buildLocationPreviewCandidates,
  normalizeLocationCoordinate,
} from '../utils/locationPreview';

type LocationMessagePreviewProps = {
  latitude: number;
  longitude: number;
  name: string | null | undefined;
  address: string | null | undefined;
  onLongPress?: () => void;
};

type MapLibreModule = {
  MapView?: ComponentType<Record<string, unknown>>;
  Camera?: ComponentType<Record<string, unknown>>;
  PointAnnotation?: ComponentType<Record<string, unknown>>;
};

type MapPreviewStatus = 'loading' | 'ready' | 'failed';

const MAPLIBRE_DEFAULT_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

const mapLibreModule = (() => {
  try {
    return require('@maplibre/maplibre-react-native') as MapLibreModule;
  } catch {
    return null;
  }
})();

const NativeMapView = mapLibreModule?.MapView ?? null;
const NativeMapCamera = mapLibreModule?.Camera ?? null;
const NativeMapPointAnnotation = mapLibreModule?.PointAnnotation ?? null;

const isExpoGoStoreClient =
  (Constants as { executionEnvironment?: string | null })
    .executionEnvironment === 'storeClient';

const mapLibreStyleUrl = (() => {
  const expoConfig = (
    Constants as {
      expoConfig?: {
        extra?: {
          mapLibreStyleUrl?: unknown;
        };
      };
    }
  ).expoConfig;
  const styleUrl = expoConfig?.extra?.mapLibreStyleUrl;
  if (typeof styleUrl === 'string' && styleUrl.trim().length > 0) {
    return styleUrl.trim();
  }
  return MAPLIBRE_DEFAULT_STYLE_URL;
})();

const hasNativeMapPreviewSupport =
  NativeMapView != null &&
  NativeMapCamera != null &&
  Platform.OS !== 'web' &&
  !isExpoGoStoreClient;

function readMapLoadErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') {
    const normalized = error.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (!error || typeof error !== 'object') return null;

  const eventRecord = error as {
    message?: unknown;
    error?: unknown;
    nativeEvent?: {
      message?: unknown;
      error?: unknown;
      payload?: {
        message?: unknown;
      };
    };
  };

  const candidates: unknown[] = [
    eventRecord.nativeEvent?.message,
    eventRecord.nativeEvent?.error,
    eventRecord.nativeEvent?.payload?.message,
    eventRecord.message,
    eventRecord.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (normalized.length > 0) return normalized;
  }

  return null;
}

async function openLocationInMaps(
  latitude: number,
  longitude: number,
  label: string | null | undefined
): Promise<void> {
  const coordinate = normalizeLocationCoordinate(latitude, longitude);
  if (!coordinate) return;

  const name = (label ?? pt.location).trim() || pt.location;
  const query = `${coordinate.latitude},${coordinate.longitude}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}`;

  if (Platform.OS === 'android') {
    const geoUrl = `geo:${coordinate.latitude},${coordinate.longitude}?q=${
      coordinate.latitude
    },${coordinate.longitude}(${encodeURIComponent(name)})`;
    try {
      await Linking.openURL(geoUrl);
      return;
    } catch {}
  }

  if (Platform.OS === 'ios') {
    const appleMapsUrl = `http://maps.apple.com/?ll=${coordinate.latitude},${
      coordinate.longitude
    }&q=${encodeURIComponent(name)}`;
    try {
      await Linking.openURL(appleMapsUrl);
      return;
    } catch {}
  }

  try {
    await Linking.openURL(webUrl);
  } catch {}
}

export function LocationMessagePreview({
  latitude,
  longitude,
  name,
  address,
  onLongPress,
}: LocationMessagePreviewProps) {
  const coordinate = useMemo(
    () => normalizeLocationCoordinate(latitude, longitude),
    [latitude, longitude]
  );
  const previewCandidates = useMemo(
    () =>
      coordinate
        ? buildLocationPreviewCandidates(
            coordinate.latitude,
            coordinate.longitude
          )
        : [],
    [coordinate]
  );
  const [previewSourceIndex, setPreviewSourceIndex] = useState(0);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false);
  const [mapPreviewStatus, setMapPreviewStatus] = useState<MapPreviewStatus>(
    hasNativeMapPreviewSupport ? 'loading' : 'failed'
  );
  const previewUri = previewCandidates[previewSourceIndex] ?? null;
  const previewCoordinateLngLat = useMemo<[number, number] | null>(
    () => (coordinate ? [coordinate.longitude, coordinate.latitude] : null),
    [coordinate]
  );
  const title = name?.trim() || pt.location;
  const addressText = address?.trim() ?? '';
  const shouldRenderNativeMap =
    hasNativeMapPreviewSupport &&
    NativeMapView &&
    NativeMapCamera &&
    previewCoordinateLngLat &&
    mapPreviewStatus !== 'failed';
  const shouldRenderStaticPreview = mapPreviewStatus === 'failed';

  useEffect(() => {
    setMapPreviewStatus(hasNativeMapPreviewSupport ? 'loading' : 'failed');
    setPreviewSourceIndex(0);
    setPreviewLoaded(false);
    setPreviewLoadFailed(false);
  }, [previewCandidates]);

  const handleOpen = useCallback(() => {
    if (!coordinate) return;
    void openLocationInMaps(
      coordinate.latitude,
      coordinate.longitude,
      title || addressText
    );
  }, [addressText, coordinate, title]);

  const handlePreviewError = useCallback(() => {
    setPreviewLoaded(false);
    if (previewSourceIndex < previewCandidates.length - 1) {
      setPreviewSourceIndex(previewSourceIndex + 1);
      return;
    }
    setPreviewLoadFailed(true);
  }, [previewCandidates.length, previewSourceIndex]);

  const handleMapPreviewLoaded = useCallback(() => {
    setMapPreviewStatus('ready');
  }, []);

  const handleMapPreviewFailed = useCallback((event: unknown) => {
    if (__DEV__) {
      console.log('MapLibre [location-preview] failed', {
        styleUrl: mapLibreStyleUrl,
        errorMessage:
          readMapLoadErrorMessage(event) ?? 'MapLibre preview loading failed.',
      });
    }
    setMapPreviewStatus('failed');
  }, []);

  if (!coordinate) return null;

  return (
    <Pressable
      style={styles.locationBubble}
      onPress={handleOpen}
      onLongPress={onLongPress}
      delayLongPress={220}
    >
      <View style={styles.locationMapPreview}>
        <View style={styles.locationMapFallback}>
          <Ionicons name="map-outline" size={28} color={colors.grey600} />
          <Ionicons
            name="location-sharp"
            size={32}
            color="#EF4444"
            style={styles.locationFallbackPin}
          />
        </View>

        {shouldRenderNativeMap ? (
          <NativeMapView
            style={styles.locationMapImage}
            mapStyle={mapLibreStyleUrl}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            pointerEvents="none"
            onDidFinishLoadingMap={handleMapPreviewLoaded}
            onDidFinishLoadingStyle={handleMapPreviewLoaded}
            onDidFailLoadingMap={handleMapPreviewFailed}
          >
            <NativeMapCamera
              centerCoordinate={previewCoordinateLngLat}
              zoomLevel={15}
              animationDuration={0}
            />
            {NativeMapPointAnnotation ? (
              <NativeMapPointAnnotation
                id={`location-preview-${coordinate.latitude}-${coordinate.longitude}`}
                coordinate={previewCoordinateLngLat}
              >
                <View style={styles.locationMapMarker}>
                  <Ionicons name="location-sharp" size={30} color="#EF4444" />
                </View>
              </NativeMapPointAnnotation>
            ) : (
              <View style={styles.locationPinOverlay} pointerEvents="none">
                <Ionicons name="location-sharp" size={36} color="#EF4444" />
              </View>
            )}
          </NativeMapView>
        ) : null}

        {shouldRenderStaticPreview && previewUri && !previewLoadFailed ? (
          <ExpoImage
            key={previewUri}
            source={{ uri: previewUri }}
            style={[
              styles.locationMapImage,
              previewLoaded
                ? styles.locationMapImageVisible
                : styles.locationMapImageHidden,
            ]}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={previewUri}
            transition={120}
            onLoad={() => setPreviewLoaded(true)}
            onError={handlePreviewError}
          />
        ) : null}

        {shouldRenderStaticPreview && previewLoaded ? (
          <View style={styles.locationPinOverlay} pointerEvents="none">
            <Ionicons name="location-sharp" size={36} color="#EF4444" />
          </View>
        ) : null}
      </View>

      <View style={styles.locationInfo}>
        <Text style={styles.locationName} numberOfLines={1}>
          {title}
        </Text>
        {addressText ? (
          <Text style={styles.locationAddress} numberOfLines={2}>
            {addressText}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  locationBubble: {
    width: '100%',
    maxWidth: 200,
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  locationMapPreview: {
    width: '100%',
    height: 112,
    overflow: 'hidden',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  locationMapImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  locationMapImageHidden: {
    opacity: 0,
  },
  locationMapImageVisible: {
    opacity: 1,
  },
  locationMapFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  locationFallbackPin: {
    position: 'absolute',
    marginTop: -18,
  },
  locationPinOverlay: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -18 }, { translateY: -32 }],
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  locationMapMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationInfo: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 0,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(17, 27, 33, 0.95)',
  },
  locationAddress: {
    fontSize: 12,
    color: colors.grey700,
    marginTop: 3,
  },
});

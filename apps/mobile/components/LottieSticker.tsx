import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import type { AnimationObject } from 'lottie-react-native/lib/typescript/types';
import JSZip from 'jszip';
import { inflate } from 'pako';
import { colors } from '../theme/colors';

type LottieStickerProps = {
  src: string;
  size?: number;
};

const animationJsonCache = new Map<string, string>();

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }

  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }

  try {
    return decodeURIComponent(escape(result));
  } catch {
    return result;
  }
}

function isZipPayload(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function resolveZipAnimationJson(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const fallbackEntries = zip.filter(
    (_, file) =>
      !file.dir &&
      file.name.endsWith('.json') &&
      !file.name.endsWith('.trust_token') &&
      !file.name.endsWith('.overridden_metadata')
  );

  const animationEntry =
    zip.file('animation/animation.json') ?? fallbackEntries[0];

  if (!animationEntry) {
    throw new Error('Animation JSON not found in sticker payload');
  }

  return animationEntry.async('string');
}

function resolveRawAnimationJson(bytes: Uint8Array): string {
  const maybeGzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (maybeGzip) {
    return inflate(bytes, { to: 'string' });
  }

  return decodeUtf8(bytes);
}

async function resolveAnimationJson(src: string): Promise<string> {
  const cached = animationJsonCache.get(src);
  if (cached) return cached;

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch sticker: ${response.status}`);
  }

  const payload = new Uint8Array(await response.arrayBuffer());
  const json = isZipPayload(payload)
    ? await resolveZipAnimationJson(payload)
    : resolveRawAnimationJson(payload);

  animationJsonCache.set(src, json);
  return json;
}

function parseAnimationData(json: string): AnimationObject {
  return JSON.parse(json) as AnimationObject;
}

export function LottieSticker({ src, size = 100 }: LottieStickerProps) {
  const [animationData, setAnimationData] = useState<AnimationObject | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!src) {
      setAnimationData(null);
      setLoading(false);
      setHasError(true);
      return;
    }

    let active = true;
    setLoading(true);
    setHasError(false);
    setAnimationData(null);

    void resolveAnimationJson(src)
      .then((json) => {
        if (!active) return;
        setAnimationData(parseAnimationData(json));
      })
      .catch(() => {
        if (!active) return;
        setHasError(true);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src]);

  const containerStyle = useMemo(
    () => [styles.container, { width: size, height: size }],
    [size]
  );

  if (hasError || !animationData) {
    return (
      <View style={containerStyle}>
        <View style={styles.fallback}>
          {loading ? (
            <ActivityIndicator color={colors.grey600} size="small" />
          ) : (
            <Ionicons
              name="document-outline"
              size={20}
              color={colors.grey700}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <LottieView source={animationData} autoPlay loop style={styles.lottie} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(47, 43, 61, 0.05)',
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
});

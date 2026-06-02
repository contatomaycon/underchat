import { NativeModules, Platform } from 'react-native';

const ANDROID_FFMPEGKIT_SUPPORTED_ABIS = new Set(['arm64-v8a', 'armeabi-v7a']);

type VideoTrimSupportNativeModule = {
  getSupportedAbis?: () => Promise<unknown>;
  canLoadFfmpegKitAbiDetect?: () => Promise<unknown>;
};

let cachedCanUseVideoTrimEditor: boolean | null = null;

export function isAndroidFfmpegKitAbiSupported(
  abis: readonly string[]
): boolean {
  return abis.some((abi) => ANDROID_FFMPEGKIT_SUPPORTED_ABIS.has(abi));
}

export function resetVideoTrimEditorSupportCacheForTests(): void {
  cachedCanUseVideoTrimEditor = null;
}

function normalizeAbiList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((abi): abi is string => typeof abi === 'string');
}

export async function canUseVideoTrimEditor(): Promise<boolean> {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'android') return false;
  if (cachedCanUseVideoTrimEditor !== null) {
    return cachedCanUseVideoTrimEditor;
  }

  const videoTrimSupportModule =
    NativeModules.VideoTrimSupportModule as VideoTrimSupportNativeModule | null;

  if (
    !videoTrimSupportModule ||
    typeof videoTrimSupportModule.getSupportedAbis !== 'function' ||
    typeof videoTrimSupportModule.canLoadFfmpegKitAbiDetect !== 'function'
  ) {
    cachedCanUseVideoTrimEditor = false;
    return cachedCanUseVideoTrimEditor;
  }

  try {
    const [supportedAbisValue, canLoadAbiDetect] = await Promise.all([
      videoTrimSupportModule.getSupportedAbis(),
      videoTrimSupportModule.canLoadFfmpegKitAbiDetect(),
    ]);

    cachedCanUseVideoTrimEditor =
      canLoadAbiDetect === true &&
      isAndroidFfmpegKitAbiSupported(normalizeAbiList(supportedAbisValue));
  } catch {
    cachedCanUseVideoTrimEditor = false;
  }

  return cachedCanUseVideoTrimEditor;
}

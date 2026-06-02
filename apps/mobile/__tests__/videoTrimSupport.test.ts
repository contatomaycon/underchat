import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type GetSupportedAbisMock = () => Promise<string[]>;
type CanLoadAbiDetectMock = () => Promise<boolean>;

const mockPlatform: { OS: string } = { OS: 'android' };
const mockNativeModules: {
  VideoTrimSupportModule?: {
    getSupportedAbis?: GetSupportedAbisMock;
    canLoadFfmpegKitAbiDetect?: CanLoadAbiDetectMock;
  };
} = {};

jest.mock('react-native', () => ({
  NativeModules: mockNativeModules,
  Platform: mockPlatform,
}));

import {
  canUseVideoTrimEditor,
  isAndroidFfmpegKitAbiSupported,
  resetVideoTrimEditorSupportCacheForTests,
} from '../utils/videoTrimSupport';

describe('videoTrimSupport', () => {
  beforeEach(() => {
    mockPlatform.OS = 'android';
    delete mockNativeModules.VideoTrimSupportModule;
    resetVideoTrimEditorSupportCacheForTests();
  });

  it('supports Android FFmpegKit ABIs shipped by the video trim package', () => {
    expect(isAndroidFfmpegKitAbiSupported(['arm64-v8a'])).toBe(true);
    expect(isAndroidFfmpegKitAbiSupported(['armeabi-v7a'])).toBe(true);
  });

  it('does not support Android x86 ABIs without FFmpegKit libraries', () => {
    expect(isAndroidFfmpegKitAbiSupported(['x86_64', 'x86'])).toBe(false);
    expect(isAndroidFfmpegKitAbiSupported([])).toBe(false);
  });

  it('returns false on Android when the native support module is missing', async () => {
    await expect(canUseVideoTrimEditor()).resolves.toBe(false);
  });

  it('returns false on Android when the native support check fails', async () => {
    mockNativeModules.VideoTrimSupportModule = {
      getSupportedAbis: jest
        .fn<GetSupportedAbisMock>()
        .mockResolvedValue(['arm64-v8a']),
      canLoadFfmpegKitAbiDetect: jest
        .fn<CanLoadAbiDetectMock>()
        .mockRejectedValue(new Error('missing native lib')),
    };

    await expect(canUseVideoTrimEditor()).resolves.toBe(false);
  });

  it('returns true on Android when ABI and native library are supported', async () => {
    mockNativeModules.VideoTrimSupportModule = {
      getSupportedAbis: jest
        .fn<GetSupportedAbisMock>()
        .mockResolvedValue(['arm64-v8a', 'armeabi-v7a']),
      canLoadFfmpegKitAbiDetect: jest
        .fn<CanLoadAbiDetectMock>()
        .mockResolvedValue(true),
    };

    await expect(canUseVideoTrimEditor()).resolves.toBe(true);
  });

  it('returns true on iOS without consulting the Android native module', async () => {
    mockPlatform.OS = 'ios';

    await expect(canUseVideoTrimEditor()).resolves.toBe(true);
  });
});

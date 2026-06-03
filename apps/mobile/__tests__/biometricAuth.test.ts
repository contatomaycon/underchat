import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

const mockSecureStore = {
  isAvailableAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  canUseBiometricAuthentication: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
};

const mockLocalAuthentication = {
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  supportedAuthenticationTypesAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => mockStorage);
jest.mock('expo-secure-store', () => mockSecureStore);
jest.mock('expo-local-authentication', () => mockLocalAuthentication);
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

describe('mobile biometricAuth', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.getItem.mockReset();
    mockStorage.setItem.mockReset();
    mockStorage.removeItem.mockReset();
    mockSecureStore.isAvailableAsync.mockReset();
    mockSecureStore.getItemAsync.mockReset();
    mockSecureStore.setItemAsync.mockReset();
    mockSecureStore.deleteItemAsync.mockReset();
    mockSecureStore.canUseBiometricAuthentication.mockReset();
    mockLocalAuthentication.supportedAuthenticationTypesAsync.mockReset();
    mockLocalAuthentication.hasHardwareAsync.mockReset();
    mockLocalAuthentication.isEnrolledAsync.mockReset();
    mockLocalAuthentication.authenticateAsync.mockReset();

    mockSecureStore.isAvailableAsync.mockResolvedValue(true as never);
    mockSecureStore.canUseBiometricAuthentication.mockReturnValue(true as never);
    mockSecureStore.setItemAsync.mockResolvedValue(undefined as never);
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined as never);
    mockLocalAuthentication.supportedAuthenticationTypesAsync.mockResolvedValue([
      1,
    ] as never);
    mockLocalAuthentication.hasHardwareAsync.mockResolvedValue(true as never);
    mockLocalAuthentication.isEnrolledAsync.mockResolvedValue(true as never);
  });

  it('reports no_hardware when the device has no biometric sensor', async () => {
    mockLocalAuthentication.hasHardwareAsync.mockResolvedValue(false as never);

    const { getBiometricCapability } = await import('../utils/biometricAuth');

    await expect(getBiometricCapability()).resolves.toEqual(
      expect.objectContaining({
        available: false,
        reason: 'no_hardware',
      })
    );
  });

  it('reports not_enrolled when biometrics are not registered', async () => {
    mockLocalAuthentication.isEnrolledAsync.mockResolvedValue(false as never);

    const { getBiometricCapability } = await import('../utils/biometricAuth');

    await expect(getBiometricCapability()).resolves.toEqual(
      expect.objectContaining({
        available: false,
        reason: 'not_enrolled',
      })
    );
  });

  it('enables biometric login after successful authentication', async () => {
    mockLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    } as never);

    const { enableBiometricLogin } = await import('../utils/biometricAuth');

    await expect(enableBiometricLogin()).resolves.toEqual({ success: true });
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'underchat.biometric.marker',
      'enabled-v1',
      expect.objectContaining({
        requireAuthentication: true,
        keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      })
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_biometric_enabled',
      'true'
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_biometric_prompt_dismissed',
      'true'
    );
  });

  it('does not enable biometric login when authentication is cancelled', async () => {
    mockLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'user_cancel',
    } as never);

    const { enableBiometricLogin } = await import('../utils/biometricAuth');

    await expect(enableBiometricLogin()).resolves.toEqual(
      expect.objectContaining({
        success: false,
        reason: 'cancelled',
      })
    );
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockStorage.setItem).not.toHaveBeenCalledWith(
      '@underchat_biometric_enabled',
      'true'
    );
  });

  it('fails unlock when the protected marker is missing', async () => {
    mockStorage.getItem.mockResolvedValue('true' as never);
    mockSecureStore.getItemAsync.mockResolvedValue(null as never);

    const { unlockBiometricSession } = await import('../utils/biometricAuth');

    await expect(unlockBiometricSession()).resolves.toEqual(
      expect.objectContaining({
        success: false,
        reason: 'marker_missing',
      })
    );
  });

  it('disables biometric login and clears the protected marker', async () => {
    const { disableBiometricLogin } = await import('../utils/biometricAuth');

    await disableBiometricLogin();

    expect(mockStorage.removeItem).toHaveBeenCalledWith(
      '@underchat_biometric_enabled'
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_biometric_prompt_dismissed',
      'true'
    );
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'underchat.biometric.marker'
    );
  });
});

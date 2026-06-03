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

jest.mock('@react-native-async-storage/async-storage', () => mockStorage);
jest.mock('expo-secure-store', () => mockSecureStore);
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

describe('mobile authStorage', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.getItem.mockReset();
    mockStorage.setItem.mockReset();
    mockStorage.removeItem.mockReset();
    mockStorage.setItem.mockResolvedValue(undefined as never);
    mockStorage.removeItem.mockResolvedValue(undefined as never);
    mockSecureStore.isAvailableAsync.mockReset();
    mockSecureStore.getItemAsync.mockReset();
    mockSecureStore.setItemAsync.mockReset();
    mockSecureStore.deleteItemAsync.mockReset();
    mockSecureStore.canUseBiometricAuthentication.mockReset();
    mockSecureStore.isAvailableAsync.mockResolvedValue(true as never);
    mockSecureStore.setItemAsync.mockResolvedValue(undefined as never);
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined as never);
  });

  it('reads the token from SecureStore on native platforms', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('secure-token' as never);

    const { getToken } = await import('../storage/authStorage');

    await expect(getToken()).resolves.toBe('secure-token');
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith(
      'underchat.auth.token'
    );
    expect(mockStorage.getItem).not.toHaveBeenCalled();
  });

  it('migrates a legacy AsyncStorage token into SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null as never);
    mockStorage.getItem.mockResolvedValue('legacy-token' as never);

    const { getToken } = await import('../storage/authStorage');

    await expect(getToken()).resolves.toBe('legacy-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'underchat.auth.token',
      'legacy-token'
    );
    expect(mockStorage.removeItem).toHaveBeenCalledWith('@underchat_token');
  });

  it('keeps the legacy token if SecureStore migration fails', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null as never);
    mockSecureStore.setItemAsync.mockRejectedValue(
      new Error('secure fail') as never
    );
    mockStorage.getItem.mockResolvedValue('legacy-token' as never);

    const { getToken } = await import('../storage/authStorage');

    await expect(getToken()).resolves.toBe('legacy-token');
    expect(mockStorage.removeItem).not.toHaveBeenCalledWith(
      '@underchat_token'
    );
  });

  it('persists new tokens in SecureStore and removes the legacy key', async () => {
    const { setToken } = await import('../storage/authStorage');

    await setToken('new-token');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'underchat.auth.token',
      'new-token'
    );
    expect(mockStorage.removeItem).toHaveBeenCalledWith('@underchat_token');
  });

  it('clears auth data and biometric login state', async () => {
    const { clearAuth } = await import('../storage/authStorage');

    await clearAuth();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'underchat.auth.token'
    );
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'underchat.biometric.marker'
    );
    expect(mockStorage.removeItem).toHaveBeenCalledWith('@underchat_token');
    expect(mockStorage.removeItem).toHaveBeenCalledWith(
      '@underchat_biometric_enabled'
    );
    expect(mockStorage.removeItem).toHaveBeenCalledWith(
      '@underchat_biometric_prompt_dismissed'
    );
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BIOMETRIC_ENABLED_KEY = '@underchat_biometric_enabled';
const BIOMETRIC_PROMPT_DISMISSED_KEY = '@underchat_biometric_prompt_dismissed';
const BIOMETRIC_MARKER_KEY = 'underchat.biometric.marker';
const BIOMETRIC_MARKER_VALUE = 'enabled-v1';

type BiometricCapabilityReason =
  | 'unsupported_platform'
  | 'secure_store_unavailable'
  | 'no_hardware'
  | 'not_enrolled'
  | 'weak_or_unavailable'
  | 'unknown';

type BiometricOperationFailureReason =
  | BiometricCapabilityReason
  | 'authentication_failed'
  | 'cancelled'
  | 'marker_missing'
  | 'not_enabled';

export type BiometricCapability =
  | {
      available: true;
      label: string;
      supportedTypes: LocalAuthentication.AuthenticationType[];
    }
  | {
      available: false;
      reason: BiometricCapabilityReason;
      label: string;
      supportedTypes: LocalAuthentication.AuthenticationType[];
    };

export type BiometricOperationResult =
  | { success: true }
  | {
      success: false;
      reason: BiometricOperationFailureReason;
      message: string;
    };

function isNativeSecureStorePlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

function getSecureStoreOptions(
  authenticationPrompt: string
): SecureStore.SecureStoreOptions {
  return {
    requireAuthentication: true,
    authenticationPrompt,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

function resolveBiometricLabel(
  supportedTypes: LocalAuthentication.AuthenticationType[]
): string {
  if (
    supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
    )
  ) {
    return Platform.OS === 'ios' ? 'Face ID' : 'reconhecimento facial';
  }

  if (
    supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
  ) {
    return Platform.OS === 'ios' ? 'Touch ID' : 'fingerprint';
  }

  return 'biometria';
}

function toFailureMessage(reason: BiometricOperationFailureReason): string {
  switch (reason) {
    case 'unsupported_platform':
      return 'Login por biometria está disponível apenas no app Android ou iOS.';
    case 'secure_store_unavailable':
      return 'Armazenamento seguro indisponível neste dispositivo.';
    case 'no_hardware':
      return 'Este dispositivo não possui biometria disponível.';
    case 'not_enrolled':
      return 'Cadastre Face ID, Touch ID ou fingerprint nas configurações do dispositivo.';
    case 'weak_or_unavailable':
      return 'A biometria cadastrada não está disponível para proteger este login.';
    case 'authentication_failed':
      return 'Não foi possível confirmar sua biometria.';
    case 'cancelled':
      return 'Confirme sua biometria para desbloquear o app.';
    case 'marker_missing':
      return 'A biometria foi alterada ou invalidada. Faça login com email e senha novamente.';
    case 'not_enabled':
      return 'Login por biometria não está ativado.';
    default:
      return 'Não foi possível usar login por biometria agora.';
  }
}

function mapAuthFailure(
  result: LocalAuthentication.LocalAuthenticationResult
): BiometricOperationResult {
  if (result.success) {
    return { success: true };
  }

  const reason =
    result.error === 'user_cancel' ||
    result.error === 'system_cancel' ||
    result.error === 'app_cancel' ||
    result.error === 'user_fallback'
      ? 'cancelled'
      : 'authentication_failed';

  return {
    success: false,
    reason,
    message: toFailureMessage(reason),
  };
}

async function isSecureStoreAvailable(): Promise<boolean> {
  if (!isNativeSecureStorePlatform()) {
    return false;
  }

  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  let supportedTypes: LocalAuthentication.AuthenticationType[] = [];

  if (!isNativeSecureStorePlatform()) {
    return {
      available: false,
      reason: 'unsupported_platform',
      label: 'biometria',
      supportedTypes,
    };
  }

  const secureStoreAvailable = await isSecureStoreAvailable();
  if (!secureStoreAvailable) {
    return {
      available: false,
      reason: 'secure_store_unavailable',
      label: 'biometria',
      supportedTypes,
    };
  }

  try {
    supportedTypes =
      await LocalAuthentication.supportedAuthenticationTypesAsync();
    const label = resolveBiometricLabel(supportedTypes);

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { available: false, reason: 'no_hardware', label, supportedTypes };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return {
        available: false,
        reason: 'not_enrolled',
        label,
        supportedTypes,
      };
    }

    const canUseBiometricSecureStore =
      typeof SecureStore.canUseBiometricAuthentication === 'function'
        ? SecureStore.canUseBiometricAuthentication()
        : true;
    if (!canUseBiometricSecureStore) {
      return {
        available: false,
        reason: 'weak_or_unavailable',
        label,
        supportedTypes,
      };
    }

    return { available: true, label, supportedTypes };
  } catch {
    return {
      available: false,
      reason: 'unknown',
      label: resolveBiometricLabel(supportedTypes),
      supportedTypes,
    };
  }
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  const enabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
  return enabled === 'true';
}

export async function setBiometricPromptDismissed(
  dismissed: boolean
): Promise<void> {
  if (dismissed) {
    await AsyncStorage.setItem(BIOMETRIC_PROMPT_DISMISSED_KEY, 'true');
    return;
  }

  await AsyncStorage.removeItem(BIOMETRIC_PROMPT_DISMISSED_KEY);
}

export async function shouldOfferBiometricLogin(): Promise<boolean> {
  const [enabled, dismissed, capability] = await Promise.all([
    isBiometricLoginEnabled(),
    AsyncStorage.getItem(BIOMETRIC_PROMPT_DISMISSED_KEY),
    getBiometricCapability(),
  ]);

  return !enabled && dismissed !== 'true' && capability.available;
}

export async function enableBiometricLogin(): Promise<BiometricOperationResult> {
  const capability = await getBiometricCapability();
  if (!capability.available) {
    return {
      success: false,
      reason: capability.reason,
      message: toFailureMessage(capability.reason),
    };
  }

  const authResult = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Ativar login por biometria',
    promptDescription:
      Platform.OS === 'android'
        ? 'Confirme sua biometria para ativar o acesso ao Underchat.'
        : undefined,
    cancelLabel: 'Cancelar',
    fallbackLabel: 'Usar senha do dispositivo',
    biometricsSecurityLevel: 'strong',
    requireConfirmation: true,
  });
  const authMapped = mapAuthFailure(authResult);
  if (!authMapped.success) {
    return authMapped;
  }

  try {
    await SecureStore.setItemAsync(
      BIOMETRIC_MARKER_KEY,
      BIOMETRIC_MARKER_VALUE,
      getSecureStoreOptions('Confirme sua biometria para ativar o login.')
    );
    await Promise.all([
      AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true'),
      setBiometricPromptDismissed(true),
    ]);
    return { success: true };
  } catch {
    return {
      success: false,
      reason: 'unknown',
      message: toFailureMessage('unknown'),
    };
  }
}

export async function disableBiometricLogin(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY),
    setBiometricPromptDismissed(true),
    SecureStore.deleteItemAsync(BIOMETRIC_MARKER_KEY).catch(() => {
      // ignore
    }),
  ]);
}

export async function clearBiometricLoginState(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY),
    AsyncStorage.removeItem(BIOMETRIC_PROMPT_DISMISSED_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_MARKER_KEY).catch(() => {
      // ignore
    }),
  ]);
}

export async function unlockBiometricSession(): Promise<BiometricOperationResult> {
  const enabled = await isBiometricLoginEnabled();
  if (!enabled) {
    return { success: true };
  }

  const capability = await getBiometricCapability();
  if (!capability.available) {
    return {
      success: false,
      reason: capability.reason,
      message: toFailureMessage(capability.reason),
    };
  }

  try {
    const marker = await SecureStore.getItemAsync(
      BIOMETRIC_MARKER_KEY,
      getSecureStoreOptions('Desbloqueie o Underchat')
    );

    if (marker !== BIOMETRIC_MARKER_VALUE) {
      return {
        success: false,
        reason: 'marker_missing',
        message: toFailureMessage('marker_missing'),
      };
    }

    return { success: true };
  } catch {
    return {
      success: false,
      reason: 'cancelled',
      message: toFailureMessage('cancelled'),
    };
  }
}

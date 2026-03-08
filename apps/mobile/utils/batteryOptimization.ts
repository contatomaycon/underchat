import { NativeModules, Platform } from 'react-native';

const { BatteryOptimizationModule } = NativeModules;

/**
 * Checks whether the app is currently exempt from Android battery
 * optimisation. Always returns `true` on iOS (no equivalent restriction).
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  if (!BatteryOptimizationModule) {
    return true;
  }

  try {
    return await BatteryOptimizationModule.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

/**
 * Opens the system dialog asking the user to whitelist the app from
 * battery optimisation. No-op on iOS.
 */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android' || !BatteryOptimizationModule) {
    return false;
  }

  try {
    return await BatteryOptimizationModule.requestIgnoreBatteryOptimizations();
  } catch {
    return false;
  }
}

/**
 * Fallback: opens the full battery-optimisation settings page.
 * No-op on iOS.
 */
export async function openBatterySettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || !BatteryOptimizationModule) {
    return false;
  }

  try {
    return await BatteryOptimizationModule.openBatterySettings();
  } catch {
    return false;
  }
}

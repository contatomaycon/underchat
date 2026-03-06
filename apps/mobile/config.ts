import { Platform } from 'react-native';

const raw =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_BACKEND_URL;
let normalized = raw ? String(raw).replace(/\/+$/, '') : '';

if (Platform.OS === 'android' && normalized.includes('localhost')) {
  normalized = normalized.replace('localhost', '10.0.2.2');
}
export const BACKEND_URL = normalized;

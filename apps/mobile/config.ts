const raw =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_BACKEND_URL;
const normalized = raw ? String(raw).replace(/\/+$/, '') : '';
export const BACKEND_URL = normalized;

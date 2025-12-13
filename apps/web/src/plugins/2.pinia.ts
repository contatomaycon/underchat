import { createPinia } from 'pinia';
import type { App } from 'vue';

export const store = createPinia();

const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;

const filterMessage = (message: unknown): boolean => {
  if (typeof message !== 'string') {
    return false;
  }
  return (
    message.includes('🍍') ||
    message.includes('store installed') ||
    message.includes('<Suspense>') ||
    message.includes('experimental feature')
  );
};

console.log = (...args: unknown[]) => {
  if (filterMessage(args[0])) {
    return;
  }
  originalLog.apply(console, args);
};

console.info = (...args: unknown[]) => {
  if (filterMessage(args[0])) {
    return;
  }
  originalInfo.apply(console, args);
};

console.warn = (...args: unknown[]) => {
  if (filterMessage(args[0])) {
    return;
  }
  originalWarn.apply(console, args);
};

export default function applyPinia(app: App) {
  app.use(store);
}

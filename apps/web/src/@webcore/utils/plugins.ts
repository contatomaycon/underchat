import type { App } from 'vue';

type VuePlugin = { install: (app: App) => void } | ((app: App) => void);
type MaybeModule = VuePlugin | { default: VuePlugin };

export const registerPlugins = (app: App) => {
  const pluginsMap = import.meta.glob<MaybeModule>(
    ['../../plugins/*.{ts,js}', '../../plugins/*/index.{ts,js}'],
    { eager: true }
  );

  const entries = Object.entries(pluginsMap).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [, mod] of entries) {
    const candidate =
      (mod as { default?: VuePlugin }).default ?? (mod as VuePlugin);

    if (typeof candidate === 'function') {
      candidate(app);
      continue;
    }

    (candidate as { install?: (app: App) => void }).install?.(app);
  }
};

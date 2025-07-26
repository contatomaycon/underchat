import type { App } from 'vue';

type VuePlugin = { install: (app: App) => void } | ((app: App) => void);

export const registerPlugins = (app: App) => {
  const pluginsMap = import.meta.glob<VuePlugin>(
    ['../../plugins/*.{ts,js}', '../../plugins/*/index.{ts,js}'],
    { eager: true }
  );

  Object.entries(pluginsMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, mod]) => {
      const plugin = (mod as { default?: VuePlugin }).default ?? mod;

      if (typeof plugin === 'function') {
        plugin(app);

        return;
      }

      plugin.install?.(app);
    });
};

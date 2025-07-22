import type { App } from 'vue';
import type { PartialDeep } from 'type-fest/source/partial-deep';
import { createLayouts } from '@layouts';
import { layoutConfig } from '@themeConfig';
import '@layouts/styles/index.scss';

export default function (app: App) {
  app.use(
    createLayouts(
      layoutConfig as PartialDeep<typeof layoutConfig, NonNullable<unknown>>
    )
  );
}

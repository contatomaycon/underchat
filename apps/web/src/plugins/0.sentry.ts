import type { App } from 'vue';
import * as Sentry from '@sentry/vue';

export default (app: App) => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    return;
  }

  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: parseFloat(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'
    ),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      if (import.meta.env.DEV) {
        console.debug(
          '[Sentry] Event captured:',
          event.event_id,
          event.message
        );
      }
      return event;
    },
    ignoreErrors: [
      'ResizeObserver loop',
      'Non-Error promise rejection captured',
    ],
  });
};

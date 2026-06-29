import { shallowRef } from 'vue';
import { WorkerWhatsappEmbeddedConfigResponse } from '@core/schema/worker/whatsappEmbeddedConfig/response.schema';

interface FacebookAuthResponse {
  code?: string;
}

interface FacebookLoginResponse {
  authResponse?: FacebookAuthResponse;
  status?: string;
}

interface FacebookSdk {
  init: (options: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>
  ) => void;
}

interface SignupSessionPayload {
  business_id?: string;
  waba_id?: string;
  phone_number_id?: string;
}

interface SignupMessage {
  type?: string;
  event?: string;
  data?: SignupSessionPayload;
}

export interface WhatsappEmbeddedSignupResult {
  code: string;
  business_id?: string;
  waba_id: string;
  phone_number_id?: string;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const sdkLoaded = shallowRef(false);
let sdkPromise: Promise<void> | null = null;

const WHATSAPP_BUSINESS_APP_ONBOARDING_FEATURE =
  'whatsapp_business_app_onboarding';
const WHATSAPP_EMBEDDED_SIGNUP_SCOPE =
  'whatsapp_business_management,whatsapp_business_messaging';
const WHATSAPP_EMBEDDED_SIGNUP_TIMEOUT_MS = 10 * 60 * 1000;
const FINISH_EVENTS = new Set([
  'FINISH',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
]);
const SILENT_SIGNUP_ERRORS = new Set([
  'whatsapp_embedded_signup_cancelled',
  'whatsapp_embedded_signup_timeout',
  'whatsapp_embedded_code_missing',
]);

const allowedOrigins = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
]);

const loadFacebookSdk = (): Promise<void> => {
  if (sdkLoaded.value && window.FB) {
    return Promise.resolve();
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      sdkLoaded.value = true;
      resolve();
    };

    if (document.getElementById('facebook-jssdk')) {
      if (window.FB) {
        sdkLoaded.value = true;
        resolve();
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('facebook_sdk_load_failed'));
    };

    document.body.appendChild(script);
  });

  return sdkPromise;
};

const parseSignupMessage = (event: MessageEvent): SignupMessage | null => {
  if (!allowedOrigins.has(event.origin)) {
    return null;
  }

  if (typeof event.data === 'string') {
    try {
      return JSON.parse(event.data) as SignupMessage;
    } catch {
      return null;
    }
  }

  if (typeof event.data === 'object' && event.data !== null) {
    return event.data as SignupMessage;
  }

  return null;
};

export const isSilentWhatsappEmbeddedSignupError = (error: unknown): boolean =>
  error instanceof Error && SILENT_SIGNUP_ERRORS.has(error.message);

export function useWhatsappEmbeddedSignup() {
  const isLoading = shallowRef(false);

  const startSignup = async (
    config: WorkerWhatsappEmbeddedConfigResponse
  ): Promise<WhatsappEmbeddedSignupResult> => {
    if (
      !config.is_configured ||
      !config.app_id ||
      !config.configuration_id ||
      !config.api_version
    ) {
      throw new Error('whatsapp_embedded_not_configured');
    }

    isLoading.value = true;
    await loadFacebookSdk();

    const facebook = window.FB;
    if (!facebook) {
      isLoading.value = false;
      throw new Error('facebook_sdk_load_failed');
    }

    facebook.init({
      appId: config.app_id,
      autoLogAppEvents: true,
      xfbml: true,
      version: config.api_version,
    });

    return new Promise<WhatsappEmbeddedSignupResult>((resolve, reject) => {
      let authCode: string | null = null;
      let sessionPayload: SignupSessionPayload | null = null;
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('whatsapp_embedded_signup_timeout'));
      }, WHATSAPP_EMBEDDED_SIGNUP_TIMEOUT_MS);

      const tryResolve = () => {
        if (!authCode || !sessionPayload?.waba_id) {
          return;
        }

        cleanup();
        resolve({
          code: authCode,
          business_id: sessionPayload.business_id,
          waba_id: sessionPayload.waba_id,
          phone_number_id: sessionPayload.phone_number_id,
        });
      };

      const onMessage = (event: MessageEvent) => {
        const message = parseSignupMessage(event);
        if (message?.type !== 'WA_EMBEDDED_SIGNUP' || !message.event) {
          return;
        }

        if (message.event === 'CANCEL') {
          cleanup();
          reject(new Error('whatsapp_embedded_signup_cancelled'));
          return;
        }

        if (message.event === 'ERROR') {
          cleanup();
          reject(new Error('whatsapp_embedded_signup_error'));
          return;
        }

        if (!FINISH_EVENTS.has(message.event)) {
          return;
        }

        sessionPayload = message.data ?? null;
        tryResolve();
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        isLoading.value = false;
      };

      window.addEventListener('message', onMessage);

      facebook.login(
        (response) => {
          authCode = response.authResponse?.code ?? null;

          tryResolve();
        },
        {
          config_id: config.configuration_id,
          scope: WHATSAPP_EMBEDDED_SIGNUP_SCOPE,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: WHATSAPP_BUSINESS_APP_ONBOARDING_FEATURE,
            sessionInfoVersion: '3',
          },
        }
      );
    });
  };

  return {
    isLoading,
    startSignup,
  };
}

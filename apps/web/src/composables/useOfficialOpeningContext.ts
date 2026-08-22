import { computed, onScopeDispose, shallowReadonly, shallowRef } from 'vue';
import type { OfficialOpeningContextResponse } from '@core/schema/chat/officialOpeningContext/response.schema';
import type { IOfficialWhatsappConversationWindowSnapshot } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import { getApiErrorRequestId } from '../utils/apiError';

export type OfficialOpeningContextWithWindow =
  OfficialOpeningContextResponse & {
    official_window?:
      | (IOfficialWhatsappConversationWindowSnapshot & {
          service_window_started_at?: string | null;
        })
      | null;
  };

export interface OfficialOpeningContextError {
  message: string;
  requestId: string | null;
}

interface OfficialOpeningIdentity {
  workerId: string;
  contactId: string;
}

interface UseOfficialOpeningContextOptions {
  loadContext: (
    workerId: string,
    contactId: string
  ) => Promise<OfficialOpeningContextResponse | null>;
  loadingErrorMessage: () => string;
}

interface LoadOptions {
  preserveContext?: boolean;
}

const sameIdentity = (
  left: OfficialOpeningIdentity | null,
  right: OfficialOpeningIdentity
): boolean =>
  left?.workerId === right.workerId && left.contactId === right.contactId;

export const useOfficialOpeningContext = (
  options: UseOfficialOpeningContextOptions
) => {
  const context = shallowRef<OfficialOpeningContextWithWindow | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<OfficialOpeningContextError | null>(null);
  const identity = shallowRef<OfficialOpeningIdentity | null>(null);
  let requestSequence = 0;
  let expirationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearExpirationTimer = (): void => {
    if (expirationTimer) {
      clearTimeout(expirationTimer);
      expirationTimer = null;
    }
  };

  const window = computed(() => context.value?.official_window ?? null);

  const scheduleExpirationRefresh = (): void => {
    clearExpirationTimer();

    const currentWindow = window.value;
    const expiresAt =
      currentWindow?.state === 'open'
        ? currentWindow.service_window_expires_at
        : currentWindow?.state === 'awaiting_contact_reply' ||
            currentWindow?.state === 'send_uncertain'
          ? currentWindow.awaiting_contact_reply_expires_at
          : null;
    if (!expiresAt) {
      return;
    }

    const expirationTimestamp = new Date(expiresAt).getTime();
    if (!Number.isFinite(expirationTimestamp)) {
      return;
    }

    const remaining = expirationTimestamp - Date.now();
    const delay = remaining > 0 ? remaining + 350 : 60_000;
    expirationTimer = setTimeout(
      () => {
        void refresh();
      },
      Math.min(delay, 2_147_000_000)
    );
  };

  const reset = (): void => {
    requestSequence += 1;
    clearExpirationTimer();
    identity.value = null;
    context.value = null;
    loading.value = false;
    error.value = null;
  };

  const load = async (
    nextIdentity: OfficialOpeningIdentity,
    loadOptions: LoadOptions = {}
  ): Promise<OfficialOpeningContextWithWindow | null> => {
    const isIdentityChange = !sameIdentity(identity.value, nextIdentity);
    identity.value = nextIdentity;
    const requestId = ++requestSequence;
    clearExpirationTimer();
    loading.value = true;
    error.value = null;

    if (isIdentityChange || !loadOptions.preserveContext) {
      context.value = null;
    }

    try {
      const result = await options.loadContext(
        nextIdentity.workerId,
        nextIdentity.contactId
      );
      if (requestId !== requestSequence) {
        return null;
      }

      if (!result) {
        error.value = {
          message: options.loadingErrorMessage(),
          requestId: null,
        };
        return null;
      }

      context.value = result as OfficialOpeningContextWithWindow;
      scheduleExpirationRefresh();
      return context.value;
    } catch (loadError) {
      if (requestId !== requestSequence) {
        return null;
      }

      context.value = null;
      error.value = {
        message: options.loadingErrorMessage(),
        requestId: getApiErrorRequestId(loadError),
      };
      return null;
    } finally {
      if (requestId === requestSequence) {
        loading.value = false;
      }
    }
  };

  async function refresh(): Promise<OfficialOpeningContextWithWindow | null> {
    if (!identity.value) {
      return null;
    }

    return load(identity.value);
  }

  onScopeDispose(reset);

  return {
    context: shallowReadonly(context),
    window,
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    load,
    refresh,
    reset,
  };
};

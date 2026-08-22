import { computed, readonly, shallowRef } from 'vue';
import type { AxiosError } from 'axios';
import { useI18n } from 'vue-i18n';
import type { IApiResponse } from '@core/common/interfaces/IApiResponse';
import type { PublicApiTokenResponse as PublicApiTokenPayload } from '@core/schema/integration/apiToken/response.schema';
import axios from '@webcore/axios';

export type PublicApiTokenStatus = 'active' | 'revoked' | 'not_configured';
export type PublicApiTokenAction = 'generate' | 'rotate' | 'revoke' | null;

export interface PublicApiToken {
  configured: boolean;
  tokenId: string | null;
  status: PublicApiTokenStatus;
  token: string | null;
  tokenPreview: string | null;
  actorUserId: string | null;
  actorUserName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const createEmptyToken = (): PublicApiToken => ({
  configured: false,
  tokenId: null,
  status: 'not_configured',
  token: null,
  tokenPreview: null,
  actorUserId: null,
  actorUserName: null,
  createdAt: null,
  updatedAt: null,
  rotatedAt: null,
  lastUsedAt: null,
  revokedAt: null,
});

const normalizeToken = (payload: PublicApiTokenPayload): PublicApiToken => ({
  configured: Boolean(payload.configured),
  tokenId: payload.token_id ?? null,
  status: payload.status ?? 'not_configured',
  token: payload.token ?? null,
  tokenPreview: payload.token_preview ?? null,
  actorUserId: payload.actor_user_id ?? null,
  actorUserName: payload.actor_user_name ?? null,
  createdAt: payload.created_at ?? null,
  updatedAt: payload.updated_at ?? null,
  rotatedAt: payload.rotated_at ?? null,
  lastUsedAt: payload.last_used_at ?? null,
  revokedAt: payload.revoked_at ?? null,
});

export function usePublicApiToken() {
  const { t } = useI18n();
  const token = shallowRef<PublicApiToken>(createEmptyToken());
  const isLoading = shallowRef(false);
  const activeAction = shallowRef<PublicApiTokenAction>(null);
  const error = shallowRef<string | null>(null);
  const success = shallowRef<string | null>(null);

  const isConfigured = computed(
    () => token.value.configured && token.value.status === 'active'
  );
  const isMutating = computed(() => activeAction.value !== null);

  const getErrorMessage = (caught: unknown, fallbackKey: string): string => {
    const fallback = t(fallbackKey);
    const axiosError = caught as AxiosError<Partial<IApiResponse<unknown>>>;
    const responseMessage = axiosError.response?.data?.message;

    if (responseMessage) return responseMessage;

    if (caught instanceof Error && caught.message) {
      return caught.message;
    }

    return fallback;
  };

  const unwrapResponse = (
    response: IApiResponse<PublicApiTokenPayload>,
    fallbackKey: string
  ): PublicApiTokenPayload => {
    if (!response.status || !response.data) {
      throw new Error(response.message || t(fallbackKey));
    }

    return response.data;
  };

  const clearFeedback = () => {
    error.value = null;
    success.value = null;
  };

  const loadToken = async (): Promise<boolean> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await axios.get<IApiResponse<PublicApiTokenPayload>>(
        '/integration/api-token'
      );
      token.value = normalizeToken(
        unwrapResponse(response.data, 'public_api_token_load_error')
      );
      return true;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'public_api_token_load_error');
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const generateToken = async (): Promise<boolean> => {
    const operation: Exclude<PublicApiTokenAction, 'revoke' | null> =
      isConfigured.value ? 'rotate' : 'generate';
    activeAction.value = operation;
    clearFeedback();

    try {
      const response = await axios.post<IApiResponse<PublicApiTokenPayload>>(
        '/integration/api-token/generate'
      );
      token.value = normalizeToken(
        unwrapResponse(response.data, 'public_api_token_generate_error')
      );
      success.value = t(
        operation === 'rotate'
          ? 'public_api_token_rotate_success'
          : 'public_api_token_generate_success'
      );
      return true;
    } catch (caught) {
      error.value = getErrorMessage(
        caught,
        operation === 'rotate'
          ? 'public_api_token_rotate_error'
          : 'public_api_token_generate_error'
      );
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  const revokeToken = async (): Promise<boolean> => {
    activeAction.value = 'revoke';
    clearFeedback();

    try {
      const response = await axios.delete<
        IApiResponse<PublicApiTokenPayload | { success: boolean }>
      >('/integration/api-token');

      if (!response.data.status) {
        throw new Error(
          response.data.message || t('public_api_token_revoke_error')
        );
      }

      token.value = createEmptyToken();
      success.value = t('public_api_token_revoke_success');
      return true;
    } catch (caught) {
      error.value = getErrorMessage(caught, 'public_api_token_revoke_error');
      return false;
    } finally {
      activeAction.value = null;
    }
  };

  return {
    token: readonly(token),
    isConfigured,
    isLoading: readonly(isLoading),
    activeAction: readonly(activeAction),
    isMutating,
    error: readonly(error),
    success: readonly(success),
    loadToken,
    generateToken,
    revokeToken,
    clearFeedback,
  };
}

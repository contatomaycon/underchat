import { injectable } from 'tsyringe';
import jwt from 'jsonwebtoken';
import {
  IPushDeliveryJob,
  IPushDeliveryResult,
} from '@core/common/interfaces/IPushDelivery';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const CHAT_NOTIFICATION_ANDROID_CHANNEL = 'underchat-messages';
const TOKEN_REFRESH_SKEW_MS = 60_000;

type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type FcmErrorResponse = {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{
      '@type'?: string;
      errorCode?: string;
    }>;
  };
};

@injectable()
export class PushFcmProviderService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private serviceAccount: FcmServiceAccount | null | undefined;

  isConfigured(): boolean {
    return this.getServiceAccount() !== null;
  }

  send = async (job: IPushDeliveryJob): Promise<IPushDeliveryResult> => {
    const serviceAccount = this.getServiceAccount();
    if (!serviceAccount) {
      return { status: 'temporary_failure', reason: 'fcm_not_configured' };
    }

    const accessToken = await this.getAccessToken(serviceAccount);
    if (!accessToken) {
      return { status: 'temporary_failure', reason: 'fcm_auth_error' };
    }

    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: job.endpoint,
              notification: {
                title: job.payload.title,
                body: job.payload.body,
              },
              android: {
                priority: 'HIGH',
                notification: {
                  channel_id: CHAT_NOTIFICATION_ANDROID_CHANNEL,
                  tag: job.payload.tag,
                  sound: 'default',
                },
              },
              data: this.stringifyData(job.payload.data),
            },
          }),
        }
      );

      if (response.ok) {
        return { status: 'success' };
      }

      const body = (await response
        .json()
        .catch(() => null)) as FcmErrorResponse | null;
      const reason =
        this.getFcmErrorReason(body) ?? `fcm_http_${response.status}`;

      if (this.isPermanentFailure(response.status, body)) {
        return { status: 'permanent_failure', reason };
      }

      return { status: 'temporary_failure', reason };
    } catch {
      return { status: 'temporary_failure', reason: 'fcm_network_error' };
    }
  };

  private getServiceAccount(): FcmServiceAccount | null {
    if (this.serviceAccount !== undefined) {
      return this.serviceAccount;
    }

    const encoded = process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64?.trim();
    if (!encoded) {
      this.serviceAccount = null;
      return this.serviceAccount;
    }

    try {
      const raw = Buffer.from(encoded, 'base64').toString('utf8');
      const parsed = JSON.parse(raw) as Partial<FcmServiceAccount>;
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        this.serviceAccount = null;
        return this.serviceAccount;
      }

      this.serviceAccount = {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, '\n'),
      };
      return this.serviceAccount;
    } catch {
      this.serviceAccount = null;
      return this.serviceAccount;
    }
  }

  private async getAccessToken(
    serviceAccount: FcmServiceAccount
  ): Promise<string | null> {
    if (
      this.accessToken &&
      this.accessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
    ) {
      return this.accessToken;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: serviceAccount.client_email,
        scope: FCM_SCOPE,
        aud: GOOGLE_OAUTH_TOKEN_URL,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      },
      serviceAccount.private_key,
      { algorithm: 'RS256' }
    );

    try {
      const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
      } | null;

      if (!response.ok || !body?.access_token) {
        return null;
      }

      this.accessToken = body.access_token;
      this.accessTokenExpiresAt =
        Date.now() + Math.max(body.expires_in ?? 3600, 60) * 1000;
      return this.accessToken;
    } catch {
      return null;
    }
  }

  private stringifyData(
    data: Record<string, unknown> | undefined
  ): Record<string, string> {
    if (!data) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ])
    );
  }

  private getFcmErrorReason(body: FcmErrorResponse | null): string | null {
    const detailReason = body?.error?.details
      ?.map((detail) => detail.errorCode)
      .find((value): value is string => !!value);

    return detailReason ?? body?.error?.status ?? body?.error?.message ?? null;
  }

  private isPermanentFailure(
    statusCode: number,
    body: FcmErrorResponse | null
  ): boolean {
    const reason = this.getFcmErrorReason(body);
    if (
      reason === 'UNREGISTERED' ||
      reason === 'SENDER_ID_MISMATCH' ||
      reason === 'THIRD_PARTY_AUTH_ERROR'
    ) {
      return true;
    }

    return statusCode === 400 && reason === 'INVALID_ARGUMENT';
  }
}

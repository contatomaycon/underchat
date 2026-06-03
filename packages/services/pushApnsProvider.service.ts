import http2 from 'node:http2';
import jwt from 'jsonwebtoken';
import { injectable } from 'tsyringe';
import {
  IPushDeliveryJob,
  IPushDeliveryResult,
} from '@core/common/interfaces/IPushDelivery';

const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
const APNS_SANDBOX_ORIGIN = 'https://api.sandbox.push.apple.com';
const TOKEN_REFRESH_SKEW_MS = 60_000;

type ApnsConfig = {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
  useSandbox: boolean;
};

type ApnsErrorBody = {
  reason?: string;
};

@injectable()
export class PushApnsProviderService {
  private authToken: string | null = null;
  private authTokenExpiresAt = 0;
  private config: ApnsConfig | null | undefined;

  isConfigured(): boolean {
    return this.getConfig() !== null;
  }

  send = async (job: IPushDeliveryJob): Promise<IPushDeliveryResult> => {
    const config = this.getConfig();
    if (!config) {
      return { status: 'temporary_failure', reason: 'apns_not_configured' };
    }

    const token = this.getAuthToken(config);
    const origin = config.useSandbox
      ? APNS_SANDBOX_ORIGIN
      : APNS_PRODUCTION_ORIGIN;
    const collapseId = job.payload.tag?.slice(0, 64);

    const headers: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${job.endpoint}`,
      authorization: `bearer ${token}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    };

    if (collapseId) {
      headers['apns-collapse-id'] = collapseId;
    }

    return this.sendRequest(origin, headers, {
      ...(job.payload.data ?? {}),
      aps: {
        alert: {
          title: job.payload.title,
          body: job.payload.body,
        },
        sound: 'default',
        ...(job.payload.tag ? { 'thread-id': job.payload.tag } : {}),
      },
    });
  };

  private getConfig(): ApnsConfig | null {
    if (this.config !== undefined) {
      return this.config;
    }

    const teamId = process.env.APNS_TEAM_ID?.trim();
    const keyId = process.env.APNS_KEY_ID?.trim();
    const bundleId = process.env.APNS_BUNDLE_ID?.trim();
    const encodedPrivateKey = process.env.APNS_PRIVATE_KEY_BASE64?.trim();

    if (!teamId || !keyId || !bundleId || !encodedPrivateKey) {
      this.config = null;
      return this.config;
    }

    try {
      this.config = {
        teamId,
        keyId,
        bundleId,
        privateKey: Buffer.from(encodedPrivateKey, 'base64')
          .toString('utf8')
          .replace(/\\n/g, '\n'),
        useSandbox: process.env.APNS_USE_SANDBOX === 'true',
      };
      return this.config;
    } catch {
      this.config = null;
      return this.config;
    }
  }

  private getAuthToken(config: ApnsConfig): string {
    if (
      this.authToken &&
      this.authTokenExpiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
    ) {
      return this.authToken;
    }

    this.authToken = jwt.sign(
      {
        iss: config.teamId,
        iat: Math.floor(Date.now() / 1000),
      },
      config.privateKey,
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: config.keyId,
        },
      }
    );
    this.authTokenExpiresAt = Date.now() + 50 * 60 * 1000;
    return this.authToken;
  }

  private sendRequest(
    origin: string,
    headers: http2.OutgoingHttpHeaders,
    payload: unknown
  ): Promise<IPushDeliveryResult> {
    return new Promise((resolve) => {
      let settled = false;
      let statusCode = 0;
      let responseBody = '';

      const finish = (result: IPushDeliveryResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      const client = http2.connect(origin);
      client.setTimeout(10_000, () => {
        client.destroy();
        finish({ status: 'temporary_failure', reason: 'apns_timeout' });
      });
      client.on('error', () => {
        finish({ status: 'temporary_failure', reason: 'apns_network_error' });
      });

      const request = client.request(headers);
      request.setEncoding('utf8');
      request.on('response', (responseHeaders) => {
        statusCode = Number(responseHeaders[':status'] ?? 0);
      });
      request.on('data', (chunk: string) => {
        responseBody += chunk;
      });
      request.on('error', () => {
        client.destroy();
        finish({ status: 'temporary_failure', reason: 'apns_request_error' });
      });
      request.on('end', () => {
        client.close();
        if (statusCode === 200) {
          finish({ status: 'success' });
          return;
        }

        const reason =
          this.parseReason(responseBody) ?? `apns_http_${statusCode}`;
        if (this.isPermanentFailure(statusCode, reason)) {
          finish({ status: 'permanent_failure', reason });
          return;
        }

        finish({ status: 'temporary_failure', reason });
      });
      request.end(JSON.stringify(payload));
    });
  }

  private parseReason(body: string): string | null {
    if (!body) {
      return null;
    }

    try {
      const parsed = JSON.parse(body) as ApnsErrorBody;
      return parsed.reason ?? null;
    } catch {
      return null;
    }
  }

  private isPermanentFailure(statusCode: number, reason: string): boolean {
    if (statusCode === 410) {
      return true;
    }

    return (
      statusCode === 400 &&
      [
        'BadDeviceToken',
        'DeviceTokenNotForTopic',
        'TopicDisallowed',
        'BadTopic',
      ].includes(reason)
    );
  }
}

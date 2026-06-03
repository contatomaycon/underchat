import 'reflect-metadata';

const mockConnect = jest.fn();

jest.mock('node:http2', () => ({
  __esModule: true,
  default: {
    connect: mockConnect,
  },
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(() => 'apns-jwt'),
  },
}));

import http2 from 'node:http2';
import { PushApnsProviderService } from '@core/services/pushApnsProvider.service';

describe('PushApnsProviderService', () => {
  const originalEnv = {
    teamId: process.env.APNS_TEAM_ID,
    keyId: process.env.APNS_KEY_ID,
    bundleId: process.env.APNS_BUNDLE_ID,
    privateKey: process.env.APNS_PRIVATE_KEY_BASE64,
    sandbox: process.env.APNS_USE_SANDBOX,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APNS_TEAM_ID = 'TEAMID';
    process.env.APNS_KEY_ID = 'KEYID';
    process.env.APNS_BUNDLE_ID = 'com.underchat.app';
    process.env.APNS_PRIVATE_KEY_BASE64 =
      Buffer.from('private-key').toString('base64');
    process.env.APNS_USE_SANDBOX = 'true';
  });

  afterAll(() => {
    process.env.APNS_TEAM_ID = originalEnv.teamId;
    process.env.APNS_KEY_ID = originalEnv.keyId;
    process.env.APNS_BUNDLE_ID = originalEnv.bundleId;
    process.env.APNS_PRIVATE_KEY_BASE64 = originalEnv.privateKey;
    process.env.APNS_USE_SANDBOX = originalEnv.sandbox;
  });

  it('maps BadDeviceToken responses to permanent failures', async () => {
    const handlers: Record<string, (value?: unknown) => void> = {};
    const request: {
      setEncoding: jest.Mock;
      on: jest.Mock;
      end: jest.Mock;
    } = {
      setEncoding: jest.fn(),
      on: jest.fn((event: string, handler: (value?: unknown) => void): void => {
        handlers[event] = handler;
      }),
      end: jest.fn(() => {
        handlers.response?.({ ':status': 400 });
        handlers.data?.(JSON.stringify({ reason: 'BadDeviceToken' }));
        handlers.end?.();
      }),
    };
    const client = {
      setTimeout: jest.fn(),
      on: jest.fn(),
      request: jest.fn(() => request),
      close: jest.fn(),
      destroy: jest.fn(),
    };
    mockConnect.mockReturnValue(client);
    const service = new PushApnsProviderService();

    await expect(
      service.send({
        id: 'job-1',
        userId: 'user-1',
        provider: 'apns',
        endpoint: 'apns-token',
        attempt: 0,
        createdAt: Date.now(),
        payload: {
          title: 'Title',
          body: 'Body',
          tag: 'chat-1',
          data: { notificationType: 'chat_message' },
        },
      })
    ).resolves.toEqual({
      status: 'permanent_failure',
      reason: 'BadDeviceToken',
    });

    expect(http2.connect).toHaveBeenCalledWith(
      'https://api.sandbox.push.apple.com'
    );
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        ':path': '/3/device/apns-token',
        authorization: 'bearer apns-jwt',
        'apns-topic': 'com.underchat.app',
      })
    );
    expect(JSON.parse(request.end.mock.calls[0][0])).toEqual(
      expect.objectContaining({
        notificationType: 'chat_message',
        aps: expect.objectContaining({
          alert: {
            title: 'Title',
            body: 'Body',
          },
        }),
      })
    );
  });
});

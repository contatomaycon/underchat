import 'reflect-metadata';

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(() => 'signed-assertion'),
  },
}));

import { PushFcmProviderService } from '@core/services/pushFcmProvider.service';

const serviceAccount = {
  project_id: 'project-1',
  client_email: 'firebase@example.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
};

describe('PushFcmProviderService', () => {
  const originalEnv = process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(
      JSON.stringify(serviceAccount)
    ).toString('base64');
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64 = originalEnv;
  });

  it('sends an FCM HTTP v1 message with stringified data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn(async () => ({
          access_token: 'access-token',
          expires_in: 3600,
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn(async () => ({ name: 'message-1' })),
      });
    const service = new PushFcmProviderService();

    await expect(
      service.send({
        id: 'job-1',
        userId: 'user-1',
        provider: 'fcm',
        endpoint: 'fcm-token',
        attempt: 0,
        createdAt: Date.now(),
        payload: {
          title: 'Title',
          body: 'Body',
          tag: 'chat-1',
          data: {
            chatSnapshot: { chat_id: 'chat-1' },
          },
        },
      })
    ).resolves.toEqual({ status: 'success' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://fcm.googleapis.com/v1/projects/project-1/messages:send',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    );
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.message.token).toBe('fcm-token');
    expect(request.message.android.notification.channel_id).toBe(
      'underchat-messages'
    );
    expect(request.message.data.chatSnapshot).toBe('{"chat_id":"chat-1"}');
  });

  it('maps unregistered token errors to permanent failures', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn(async () => ({
          access_token: 'access-token',
          expires_in: 3600,
        })),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: jest.fn(async () => ({
          error: {
            status: 'NOT_FOUND',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        })),
      });
    const service = new PushFcmProviderService();

    await expect(
      service.send({
        id: 'job-1',
        userId: 'user-1',
        provider: 'fcm',
        endpoint: 'fcm-token',
        attempt: 0,
        createdAt: Date.now(),
        payload: { title: 'Title', body: 'Body' },
      })
    ).resolves.toEqual({
      status: 'permanent_failure',
      reason: 'UNREGISTERED',
    });
  });
});

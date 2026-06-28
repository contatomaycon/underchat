import 'reflect-metadata';
import { PushExpoProviderService } from '@core/services/pushExpoProvider.service';

describe('PushExpoProviderService', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });

  it('selects Android channels from sound and vibration preferences', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: jest.fn(async () => ({
        data: [
          { status: 'ok' },
          { status: 'ok' },
          { status: 'ok' },
          { status: 'ok' },
        ],
      })),
    });
    const service = new PushExpoProviderService();

    await expect(
      service.sendBatch([
        {
          id: 'job-1',
          userId: 'user-1',
          provider: 'expo',
          endpoint: 'ExpoPushToken[1]',
          attempt: 0,
          createdAt: Date.now(),
          payload: { title: 'Title', body: 'Body', vibrate: true },
        },
        {
          id: 'job-2',
          userId: 'user-2',
          provider: 'expo',
          endpoint: 'ExpoPushToken[2]',
          attempt: 0,
          createdAt: Date.now(),
          payload: { title: 'Title', body: 'Body' },
        },
        {
          id: 'job-3',
          userId: 'user-3',
          provider: 'expo',
          endpoint: 'ExpoPushToken[3]',
          attempt: 0,
          createdAt: Date.now(),
          payload: {
            title: 'Title',
            body: 'Body',
            sound: false,
            vibrate: true,
          },
        },
        {
          id: 'job-4',
          userId: 'user-4',
          provider: 'expo',
          endpoint: 'ExpoPushToken[4]',
          attempt: 0,
          createdAt: Date.now(),
          payload: {
            title: 'Title',
            body: 'Body',
            sound: false,
            vibrate: false,
          },
        },
      ])
    ).resolves.toEqual([
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
    ]);

    const messages = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(
      messages.map((message: { channelId: string }) => message.channelId)
    ).toEqual([
      'underchat-messages',
      'underchat-messages-sound',
      'underchat-messages-vibrate',
      'underchat-messages-silent',
    ]);
    expect(messages[0].sound).toBe('default');
    expect(messages[1].sound).toBe('default');
    expect(messages[2].sound).toBeUndefined();
    expect(messages[3].sound).toBeUndefined();
  });
});

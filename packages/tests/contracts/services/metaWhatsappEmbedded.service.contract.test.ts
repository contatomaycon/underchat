import 'reflect-metadata';
import {
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';

describe('MetaWhatsappEmbeddedService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('subscribes the app to WABA webhooks through Graph API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () => JSON.stringify({ success: true })),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.subscribeWabaApp({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/waba-1/subscribed_apps',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
        },
      }
    );
  });

  it('returns false when Graph API returns success false', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () => JSON.stringify({ success: false })),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.subscribeWabaApp({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).resolves.toBe(false);
  });

  it('throws Meta Graph errors when subscription is rejected', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      text: jest.fn(async () =>
        JSON.stringify({
          error: {
            message: 'Missing permission',
            type: 'OAuthException',
            code: 200,
          },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.subscribeWabaApp({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).rejects.toBeInstanceOf(MetaGraphApiError);
  });
});

import 'reflect-metadata';
jest.mock('@core/common/functions/downloadMediaBuffer', () => ({
  downloadMediaBuffer: jest.fn(),
}));

import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';
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

  it('sends location messages through the Message API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.location', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendLocationMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      latitude: -15.8,
      longitude: -47.9,
      name: 'Brasilia',
      address: 'DF',
      contextMessageId: 'wamid.quoted',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '5511999999999',
          type: 'location',
          location: {
            latitude: -15.8,
            longitude: -47.9,
            name: 'Brasilia',
            address: 'DF',
          },
          context: {
            message_id: 'wamid.quoted',
          },
        }),
      })
    );
  });

  it('sends contact messages through the Message API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.contacts', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendContactsMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      contacts: [
        {
          name: {
            formatted_name: 'Braian Silva',
            first_name: 'Braian',
          },
          phones: [{ phone: '+55 61991211783', wa_id: '5561991211783' }],
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '5511999999999',
          type: 'contacts',
          contacts: [
            {
              name: {
                formatted_name: 'Braian Silva',
                first_name: 'Braian',
              },
              phones: [{ phone: '+55 61991211783', wa_id: '5561991211783' }],
            },
          ],
        }),
      })
    );
  });

  it('uploads media from a backend-readable URL before media send', async () => {
    (downloadMediaBuffer as jest.Mock).mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      contentType: 'image/jpeg',
      filename: 'avatar.jpg',
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () => JSON.stringify({ id: 'media-1' })),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.uploadMediaFromUrl({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        url: 'http://storage.local/avatar.jpg',
      })
    ).resolves.toBe('media-1');

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://graph.facebook.com/v25.0/phone-1/media'
    );
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: 'Bearer token-1',
    });
    expect(request?.body).toBeInstanceOf(FormData);
  });
});

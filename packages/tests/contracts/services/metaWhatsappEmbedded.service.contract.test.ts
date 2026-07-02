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

  it('sends official interactive messages through the Message API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.interactive', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendInteractiveMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      interactive: {
        type: 'button',
        body: { text: 'Escolha' },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: { id: '1', title: 'Sim' },
            },
          ],
        },
      },
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
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: 'Escolha' },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: { id: '1', title: 'Sim' },
                },
              ],
            },
          },
          context: {
            message_id: 'wamid.quoted',
          },
        }),
      })
    );
  });

  it('marks incoming messages as read through the Message API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () => JSON.stringify({ success: true })),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.markMessageAsRead({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        messageId: 'wamid.inbound-1',
      })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: 'wamid.inbound-1',
        }),
      }
    );
  });

  it('sends audio messages as voice messages when requested', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.audio', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendAudioMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      mediaId: 'media-audio-1',
      voice: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '5511999999999',
          type: 'audio',
          audio: {
            id: 'media-audio-1',
            voice: true,
          },
        }),
      })
    );
  });

  it('omits voice for basic audio messages', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.audio', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendAudioMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      mediaId: 'media-audio-1',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body)) as {
      audio: Record<string, unknown>;
    };

    expect(body.audio).toEqual({ id: 'media-audio-1' });
    expect(body.audio).not.toHaveProperty('voice');
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

  it('loads WABA health with official account fields and bearer token', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          id: 'waba-1',
          name: 'Underchat',
          currency: 'USD',
          business_verification_status: 'not_verified',
          health_status: { can_send_message: 'LIMITED' },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.viewWabaHealth({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).resolves.toMatchObject({
      id: 'waba-1',
      name: 'Underchat',
      currency: 'USD',
      business_verification_status: 'not_verified',
      health_status: { can_send_message: 'LIMITED' },
    });

    const url = fetchMock.mock.calls[0]?.[0] as URL;
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(url.toString()).toContain(
      'https://graph.facebook.com/v25.0/waba-1?'
    );
    expect(url.searchParams.get('fields')).toContain('health_status');
    expect(url.searchParams.get('fields')).toContain(
      'business_verification_status'
    );
    expect(request?.headers).toEqual({
      Authorization: 'Bearer token-1',
    });
  });

  it('loads phone number health and normalizes throughput level', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          id: 'phone-1',
          display_phone_number: '+55 61 9203-7138',
          verified_name: 'Underchat',
          status: 'CONNECTED',
          quality_rating: 'GREEN',
          throughput: { level: 'STANDARD' },
          messaging_limit_tier: 'TIER_250',
          is_on_biz_app: true,
          health_status: { can_send_message: 'LIMITED' },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.viewPhoneNumberHealth({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
      })
    ).resolves.toMatchObject({
      id: 'phone-1',
      display_phone_number: '+55 61 9203-7138',
      quality_rating: 'GREEN',
      throughput_level: 'STANDARD',
      messaging_limit_tier: 'TIER_250',
      is_on_biz_app: true,
      health_status: { can_send_message: 'LIMITED' },
    });

    const url = fetchMock.mock.calls[0]?.[0] as URL;
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(url.toString()).toContain(
      'https://graph.facebook.com/v25.0/phone-1?'
    );
    expect(url.searchParams.get('fields')).toContain('messaging_limit_tier');
    expect(url.searchParams.get('fields')).toContain('is_on_biz_app');
    expect(request?.headers).toEqual({
      Authorization: 'Bearer token-1',
    });
  });

  it('loads message analytics totals for the requested period', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          analytics: {
            data_points: [
              { start: 10, end: 20, sent: 2, delivered: 1 },
              { start: 20, end: 30, sent: 3, delivered: 3 },
            ],
          },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.viewMessageAnalytics({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
        start: 10,
        end: 30,
      })
    ).resolves.toMatchObject({
      totals: {
        sent: 5,
        delivered: 4,
      },
    });

    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get('fields')).toBe(
      'analytics.start(10).end(30).granularity(DAY).phone_numbers([])'
    );
  });

  it('keeps conversation analytics empty when Meta returns no data points', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          conversation_analytics: {
            data: [],
          },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.viewConversationAnalytics({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
        start: 10,
        end: 30,
      })
    ).resolves.toEqual({
      data_points: [],
      totals: {
        conversations: 0,
        cost: 0,
      },
    });
  });
});

import 'reflect-metadata';
jest.mock('@core/common/functions/downloadMediaBuffer', () => ({
  downloadMediaBuffer: jest.fn(),
}));

import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';
import {
  META_WHATSAPP_GRAPH_REQUEST_TIMEOUT_MS,
  MetaGraphApiError,
  MetaGraphRequestTimeoutError,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';

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
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
        },
        signal: expect.any(AbortSignal),
      })
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

  it('diagnoses token ownership, validity and granted permissions', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          data: {
            app_id: 'app-1',
            type: 'SYSTEM_USER',
            is_valid: true,
            issued_at: 1_785_789_163,
            expires_at: 0,
            data_access_expires_at: 0,
            scopes: ['business_management', 'whatsapp_business_management'],
          },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.debugAccessToken({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        appId: 'app-1',
        appSecret: 'secret-1',
      })
    ).resolves.toMatchObject({
      app_id: 'app-1',
      type: 'SYSTEM_USER',
      is_valid: true,
      scopes: ['business_management', 'whatsapp_business_management'],
    });

    const [request, options] = fetchMock.mock.calls[0] ?? [];
    const requestedUrl = new URL(String(request));
    expect(requestedUrl.pathname).toBe('/v25.0/debug_token');
    expect(requestedUrl.searchParams.get('input_token')).toBe('token-1');
    expect(options).toEqual(
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer app-1|secret-1',
        },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('checks whether the configured app is subscribed to the WABA webhook', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          data: [
            { whatsapp_business_api_data: { id: 'another-app' } },
            { whatsapp_business_api_data: { id: 'app-1' } },
          ],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.viewWabaWebhookSubscription({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
        appId: 'app-1',
      })
    ).resolves.toEqual({
      subscribed: true,
      subscription_count: 2,
    });
  });

  it('preserves the template parameter format returned by Meta', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          data: [
            {
              id: 'template-1',
              name: 'service_update',
              language: 'pt_BR',
              status: 'APPROVED',
              category: 'UTILITY',
              parameter_format: 'NAMED',
              components: [{ type: 'BODY', text: 'Olá {{ name }}' }],
            },
          ],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    const templates = await service.listApprovedMessageTemplates({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });

    expect(templates).toEqual([
      expect.objectContaining({
        name: 'service_update',
        parameter_format: 'NAMED',
      }),
    ]);

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('fields')).toContain(
      'parameter_format'
    );
    expect(requestedUrl.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: {
        Authorization: 'Bearer token-1',
      },
    });

    const [normalized] =
      new OfficialWhatsappTemplateService().normalizeTemplates(templates);
    expect(normalized).toMatchObject({
      name: 'service_update',
      parameter_format: 'NAMED',
      variables: [],
    });
  });

  it('keeps pagination authenticated without exposing the token in URLs', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn(async () =>
          JSON.stringify({
            data: [
              {
                id: 'template-1',
                name: 'first_template',
                language: 'pt_BR',
                status: 'APPROVED',
                category: 'UTILITY',
                components: [],
              },
            ],
            paging: {
              next: 'https://graph.facebook.com/v25.0/waba-1/message_templates?after=cursor-1&access_token=stale-token',
            },
          })
        ),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn(async () =>
          JSON.stringify({
            data: [
              {
                id: 'template-2',
                name: 'second_template',
                language: 'pt_BR',
                status: 'APPROVED',
                category: 'UTILITY',
                components: [],
              },
            ],
          })
        ),
      } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.listApprovedMessageTemplates({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).resolves.toHaveLength(2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [request, options] of fetchMock.mock.calls) {
      expect(new URL(String(request)).searchParams.has('access_token')).toBe(
        false
      );
      expect(options).toEqual({
        headers: {
          Authorization: 'Bearer token-1',
        },
      });
    }
  });

  it('refuses a pagination URL outside Meta Graph before sending credentials', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          data: [],
          paging: {
            next: 'https://invalid.example/message_templates',
          },
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.listApprovedMessageTemplates({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        wabaId: 'waba-1',
      })
    ).rejects.toThrow('Invalid Meta Graph pagination URL');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a missing parameter format so named placeholders can be inferred', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          data: [
            {
              id: 'template-without-format',
              name: 'service_update',
              language: 'pt_BR',
              status: 'APPROVED',
              category: 'UTILITY',
              components: [{ type: 'BODY', text: 'Olá {{name}}' }],
            },
          ],
        })
      ),
    } as never);
    const metaService = new MetaWhatsappEmbeddedService();

    const templates = await metaService.listApprovedMessageTemplates({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });
    const [normalized] =
      new OfficialWhatsappTemplateService().normalizeTemplates(templates);

    expect(templates[0]?.parameter_format).toBeUndefined();
    expect(normalized).toMatchObject({
      parameter_format: 'NAMED',
      variables: [
        expect.objectContaining({
          key: 'BODY:name',
          parameter_name: 'name',
        }),
      ],
    });
  });

  it('sends named template parameter names in the Graph payload', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.template', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendTemplateMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      templateName: 'service_update',
      language: 'pt_BR',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maycon', parameter_name: 'name' },
          ],
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/phone-1/messages',
      expect.objectContaining({
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '5511999999999',
          type: 'template',
          template: {
            name: 'service_update',
            language: { code: 'pt_BR' },
            components: [
              {
                type: 'body',
                parameters: [
                  {
                    type: 'text',
                    text: 'Maycon',
                    parameter_name: 'name',
                  },
                ],
              },
            ],
          },
        }),
      })
    );
  });

  it('serializes quick reply payload parameters in the Graph template request', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.quick-reply', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await service.sendTemplateMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      templateName: 'iniciar_conversa_novo',
      language: 'pt_BR',
      components: [
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: 'Continuar atendimento' }],
        },
      ],
    });

    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)
    ) as { template: { components: unknown } };
    expect(request.template.components).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'Continuar atendimento' }],
      },
    ]);
  });

  it('keeps the Meta send deadline active while reading the response body', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return {
          ok: true,
          text: jest.fn(
            () =>
              new Promise<string>((_resolve, reject) => {
                requestSignal?.addEventListener(
                  'abort',
                  () => reject(requestSignal?.reason),
                  { once: true }
                );
              })
          ),
        } as never;
      });
    const service = new MetaWhatsappEmbeddedService();

    try {
      const send = service.sendTextMessage({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        to: '5511999999999',
        message: 'timeout body',
      });
      const rejected = expect(send).rejects.toBeInstanceOf(
        MetaGraphRequestTimeoutError
      );

      await jest.advanceTimersByTimeAsync(
        META_WHATSAPP_GRAPH_REQUEST_TIMEOUT_MS
      );
      await rejected;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a successful Graph response that has no provider message id', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ wa_id: '5511999999999' }],
          messages: [],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.sendTextMessage({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        to: '5511999999999',
        message: 'missing provider ack',
      })
    ).rejects.toThrow(
      'Meta Graph API accepted the request without returning a message id'
    );
  });

  it('aborts a stalled Meta media upload at the bounded request deadline', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            'abort',
            () => reject(requestSignal?.reason),
            { once: true }
          );
        })
    );
    const service = new MetaWhatsappEmbeddedService();

    try {
      const upload = service.uploadWhatsappMedia({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        buffer: Buffer.from('image'),
        filename: 'image.jpg',
        mimetype: 'image/jpeg',
      });
      const rejected = expect(upload).rejects.toBeInstanceOf(
        MetaGraphRequestTimeoutError
      );

      await jest.advanceTimersByTimeAsync(
        META_WHATSAPP_GRAPH_REQUEST_TIMEOUT_MS
      );
      await rejected;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the inbound Meta media deadline active while reading the body', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          arrayBuffer: jest.fn(
            () =>
              new Promise<ArrayBuffer>((_resolve, reject) => {
                requestSignal?.addEventListener(
                  'abort',
                  () => reject(requestSignal?.reason),
                  { once: true }
                );
              })
          ),
        } as never;
      });
    const service = new MetaWhatsappEmbeddedService();

    try {
      const download = service.downloadMedia({
        accessToken: 'token-1',
        url: 'https://lookaside.fbsbx.com/media-1',
      });
      const rejected = expect(download).rejects.toBeInstanceOf(
        MetaGraphRequestTimeoutError
      );

      await jest.advanceTimersByTimeAsync(
        META_WHATSAPP_GRAPH_REQUEST_TIMEOUT_MS
      );
      await rejected;

      expect(fetchMock).toHaveBeenCalledWith(
        'https://lookaside.fbsbx.com/media-1',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
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

  it('serializes a CTA URL message exactly as required by Graph API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: jest.fn(async () =>
        JSON.stringify({
          contacts: [{ wa_id: '5511999999999' }],
          messages: [{ id: 'wamid.cta', message_status: 'accepted' }],
        })
      ),
    } as never);
    const service = new MetaWhatsappEmbeddedService();
    const googleSitesUrl =
      'https://sites.google.com/contabilidadehohl.com.br/atendimento';

    await service.sendInteractiveMessage({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      phoneNumberId: 'phone-1',
      to: '5511999999999',
      interactive: {
        type: 'cta_url',
        header: { type: 'text', text: 'CTA URL' },
        body: { text: 'Abrir link' },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: 'Clique aqui',
            url: googleSitesUrl,
          },
        },
      },
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
            type: 'cta_url',
            header: { type: 'text', text: 'CTA URL' },
            body: { text: 'Abrir link' },
            action: {
              name: 'cta_url',
              parameters: {
                display_text: 'Clique aqui',
                url: googleSitesUrl,
              },
            },
          },
        }),
      })
    );
  });

  it('rejects an invalid interactive before calling the Graph API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const service = new MetaWhatsappEmbeddedService();

    await expect(
      service.sendInteractiveMessage({
        apiVersion: 'v25.0',
        accessToken: 'token-1',
        phoneNumberId: 'phone-1',
        to: '5511999999999',
        interactive: {
          type: 'list',
          body: { text: 'Escolha' },
          action: {
            button: 'A'.repeat(21),
            sections: [],
          },
        },
      })
    ).rejects.toThrow('official_whatsapp_interactive_limit_exceeded');

    expect(fetchMock).not.toHaveBeenCalled();
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

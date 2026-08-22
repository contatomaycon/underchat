import { Value } from '@sinclair/typebox/value';
import fastJson from 'fast-json-stringify';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { listMessageResultSchema } from '@core/schema/chat/listMessageChats/response.schema';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';

describe('listMessageChats response contract', () => {
  it('exposes sent_from_platform as an optional nullable boolean', () => {
    expect(
      Value.Check(listMessageResultSchema, {
        message_id: 'message-1',
        chat_id: 'chat-1',
        type_user: ETypeUserChat.operator,
        message_key: {
          from_me: true,
          is_view_once: false,
        },
        content: {
          type: EMessageType.text,
          message: 'Sent from WhatsApp',
        },
        summary: {
          is_sent: true,
          is_delivered: true,
          is_seen: false,
          is_sent_to_internal: true,
        },
        date: '2026-06-28T12:00:00.000Z',
        sent_from_platform: false,
      })
    ).toBe(true);

    expect(
      Value.Check(listMessageResultSchema, {
        message_id: 'message-2',
        chat_id: 'chat-1',
        type_user: ETypeUserChat.client,
        date: '2026-06-28T12:01:00.000Z',
        sent_from_platform: null,
      })
    ).toBe(true);
  });

  it('maps sent_from_platform as a boolean field in Elasticsearch', () => {
    const mapping = mensageMappings();
    type MappingProperty = {
      type?: string;
      enabled?: boolean;
      dynamic?: boolean;
      properties?: Record<string, MappingProperty>;
    };
    const properties = mapping.mappings.properties as Record<
      string,
      MappingProperty
    >;

    expect(properties.sent_from_platform).toEqual({ type: 'boolean' });
    expect(properties.content).toEqual(
      expect.objectContaining({
        type: 'nested',
        dynamic: false,
      })
    );
    expect(properties.content?.properties?.official_template).toEqual({
      type: 'object',
      dynamic: false,
      enabled: false,
    });
    expect(
      properties.content?.properties?.official?.properties?.display
    ).toEqual({
      type: 'object',
      enabled: false,
    });
    expect(properties.content?.properties?.official?.properties?.raw).toEqual({
      type: 'object',
      enabled: false,
    });
  });

  it('exposes the provider failure diagnostics used by realtime clients', () => {
    expect(
      Value.Check(listMessageResultSchema, {
        message_id: 'message-failed-1',
        chat_id: 'chat-1',
        type_user: ETypeUserChat.operator,
        date: '2026-08-16T19:49:55.000Z',
        delivery_status: 'failed',
        provider_error_code: 131047,
        provider_status_at: '2026-08-16T19:49:59.000Z',
      })
    ).toBe(true);

    const properties = mensageMappings().mappings.properties;
    expect(properties.provider_error_code).toEqual({ type: 'integer' });
    expect(properties.provider_status_at).toEqual({ type: 'date' });
  });

  it('exposes official display metadata for rich Meta messages', () => {
    expect(
      Value.Check(listMessageResultSchema, {
        message_id: 'message-official-1',
        chat_id: 'chat-1',
        type_user: ETypeUserChat.operator,
        message_key: {
          from_me: true,
          is_view_once: false,
        },
        content: {
          type: EMessageType.official_interactive,
          message: 'Escolha uma opção',
          official: {
            provider: 'meta_whatsapp',
            type: 'interactive',
            display: {
              kind: 'button',
              raw_type: 'button',
              body: 'Escolha uma opção',
              actions: [
                {
                  id: 'yes',
                  title: 'Sim',
                  type: 'reply',
                },
              ],
            },
          },
        },
        summary: {
          is_sent: true,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        },
        date: '2026-07-01T12:00:00.000Z',
      })
    ).toBe(true);
  });

  it('accepts CTA URL official display metadata with action URL', () => {
    expect(
      Value.Check(listMessageResultSchema, {
        message_id: 'message-official-cta-url-1',
        chat_id: 'chat-1',
        type_user: ETypeUserChat.operator,
        message_key: {
          from_me: true,
          is_view_once: false,
        },
        content: {
          type: EMessageType.text,
          message: 'Clique no link para abrir',
          official: {
            provider: 'meta_whatsapp',
            type: 'interactive',
            display: {
              kind: 'cta_url',
              raw_type: 'cta_url',
              body: 'Clique no link para abrir',
              action_label: 'Underchat',
              actions: [
                {
                  type: 'cta_url',
                  title: 'Underchat',
                  url: 'https://underchat.com.br/',
                },
              ],
            },
          },
        },
        summary: {
          is_sent: true,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        },
        date: '2026-07-02T12:00:00.000Z',
      })
    ).toBe(true);
  });

  it('serializes received contact cards without a linked contact id', () => {
    const result = {
      message_id: 'message-contact-card-1',
      chat_id: 'chat-1',
      type_user: ETypeUserChat.client,
      message_key: {
        from_me: false,
        is_view_once: false,
      },
      content: {
        type: EMessageType.contact_card,
        contact: {
          name: 'Bradesco',
          phone: '1133350237',
          phone_partial: '1133350237',
          phone_ddi: '55',
        },
      },
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: true,
        is_sent_to_internal: false,
      },
      date: '2026-07-03T12:00:00.000Z',
    };

    expect(Value.Check(listMessageResultSchema, result)).toBe(true);

    const stringify = fastJson(listMessageChatsSchema.response[200] as never);

    const serialized = stringify({
      id: null,
      status: true,
      message: 'chat_list_success',
      data: {
        pagings: {
          current_page: 1,
          total_pages: 1,
          per_page: 10,
          count: 1,
          total: 1,
        },
        results: [result],
        official_window: {
          is_official: true,
          state: 'open',
          reason: 'customer_service_window_open',
          can_send_freeform: true,
          can_send_template: true,
          last_inbound_at: '2026-07-03T12:00:00.000Z',
          service_window_expires_at: '2026-07-04T12:00:00.000Z',
        },
      },
    });

    expect(JSON.parse(serialized).data.official_window).toMatchObject({
      state: 'open',
      can_send_freeform: true,
    });
  });
});

import { Value } from '@sinclair/typebox/value';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { listMessageResultSchema } from '@core/schema/chat/listMessageChats/response.schema';

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
      properties?: Record<string, MappingProperty>;
    };
    const properties = mapping.mappings.properties as Record<
      string,
      MappingProperty
    >;

    expect(properties.sent_from_platform).toEqual({ type: 'boolean' });
    expect(
      properties.content?.properties?.official?.properties?.display
    ).toEqual({
      type: 'object',
      enabled: false,
    });
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
});

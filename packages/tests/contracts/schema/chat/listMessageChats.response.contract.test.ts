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
    const properties = mapping.mappings.properties as Record<
      string,
      { type?: string }
    >;

    expect(properties.sent_from_platform).toEqual({ type: 'boolean' });
  });
});

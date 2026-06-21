import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createMessageTemplateRequestSchema } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { updateMessageTemplateRequestSchema } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

const channelId1 = '019b6f9d-403d-7000-8f2e-d830604d2a40';
const channelId2 = '019b6f9d-7c19-7001-89f3-5e1f9b5b5101';
const statusId = '019b6f9e-050d-7002-8f14-d9cf39d8a2d9';

function validateSchema(schema: unknown, payload: unknown): boolean {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  return ajv.validate(schema as never, payload);
}

describe('MessageTemplate channel_ids schema', () => {
  it('accepts multipart repeated channel fields on create', () => {
    expect(
      validateSchema(createMessageTemplateRequestSchema, {
        message: { value: 'hello' },
        command: { value: 'start' },
        channel_ids: [{ value: channelId1 }, { value: channelId2 }],
        message_status_id: { value: statusId },
        type: { value: 'text' },
      })
    ).toBe(true);
  });

  it('accepts multipart repeated channel fields on update', () => {
    expect(
      validateSchema(updateMessageTemplateRequestSchema, {
        message: { value: 'hello' },
        command: { value: 'start' },
        channel_ids: [{ value: channelId1 }, { value: channelId2 }],
        message_status_id: { value: statusId },
        type: { value: 'text' },
      })
    ).toBe(true);
  });

  it('keeps accepting null-like channel clearing on update', () => {
    expect(
      validateSchema(updateMessageTemplateRequestSchema, {
        message: { value: 'hello' },
        command: { value: 'start' },
        channel_ids: { value: null },
        message_status_id: { value: statusId },
        type: { value: 'text' },
      })
    ).toBe(true);

    expect(
      validateSchema(updateMessageTemplateRequestSchema, {
        message: { value: 'hello' },
        command: { value: 'start' },
        channel_ids: 'null',
        message_status_id: { value: statusId },
        type: { value: 'text' },
      })
    ).toBe(true);
  });
});

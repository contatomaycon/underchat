import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { reactMessageSchema } from '@core/schema/chat/reactMessage';
import { deleteMessageSchema } from '@core/schema/chat/deleteMessage';
import { editMessageSchema } from '@core/schema/chat/editMessage';
import { forwardMessageSchema } from '@core/schema/chat/forwardMessage';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { deleteMessageBodySchema } from '@core/schema/chat/deleteMessage/request.schema';

const OPERATION_ID = '019a0000-0000-7000-8000-000000000001';
const TARGET_ID = '019a0000-0000-7000-8000-000000000002';

describe('worker command action HTTP schemas', () => {
  const previousUuidFormat = FormatRegistry.Get('uuid');
  const previousDateTimeFormat = FormatRegistry.Get('date-time');

  beforeAll(() => {
    FormatRegistry.Set('uuid', (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value
      )
    );
    FormatRegistry.Set('date-time', (value) =>
      Number.isFinite(Date.parse(value))
    );
  });

  afterAll(() => {
    if (previousUuidFormat) FormatRegistry.Set('uuid', previousUuidFormat);
    else FormatRegistry.Delete('uuid');
    if (previousDateTimeFormat) {
      FormatRegistry.Set('date-time', previousDateTimeFormat);
    } else FormatRegistry.Delete('date-time');
  });

  it.each([
    ['reaction', reactMessageSchema, { emoji: '👍' }],
    ['edit', editMessageSchema, { message: 'edited' }],
  ] as const)('keeps operation_id optional for %s', (_, schema, body) => {
    expect(Value.Check(schema.body, body)).toBe(true);
    expect(
      Value.Check(schema.body, { ...body, operation_id: OPERATION_ID })
    ).toBe(true);
    expect(Value.Check(schema.body, { ...body, operation_id: '' })).toBe(false);
  });

  it('accepts a legacy delete without a body and validates an optional identity body', () => {
    expect(Value.Check(deleteMessageSchema.body, undefined)).toBe(true);
    expect(Value.Check(deleteMessageBodySchema, {})).toBe(true);
    expect(
      Value.Check(deleteMessageBodySchema, { operation_id: OPERATION_ID })
    ).toBe(true);
    expect(Value.Check(deleteMessageBodySchema, { operation_id: '' })).toBe(
      false
    );
  });

  it('generates a canonical UUIDv7 base identity for fan-out when omitted', () => {
    const body = { target_chat_ids: [TARGET_ID] };
    expect(Value.Check(forwardMessageSchema.body, body)).toBe(true);
    expect(
      Value.Check(forwardMessageSchema.body, {
        ...body,
        idempotency_key: '019a0000-0000-4000-8000-000000000001',
      })
    ).toBe(false);
    expect(
      Value.Check(forwardMessageSchema.body, {
        ...body,
        idempotency_key: OPERATION_ID,
      })
    ).toBe(true);
  });

  it('keeps both operation_id and the existing deterministic hash optional for direct messages', () => {
    const body = { type: 'text', message: 'hello' };
    expect(createMessageChatsSchema.body.anyOf).toBeUndefined();
    expect(Value.Check(createMessageChatsSchema.body, body)).toBe(true);
    expect(
      Value.Check(createMessageChatsSchema.body, {
        ...body,
        hash: OPERATION_ID,
      })
    ).toBe(true);
    expect(
      Value.Check(createMessageChatsSchema.body, {
        ...body,
        operation_id: OPERATION_ID,
      })
    ).toBe(true);
  });

  it.each([
    ['reaction', reactMessageSchema, 'operation_id'],
    ['edit', editMessageSchema, 'operation_id'],
    ['forward', forwardMessageSchema, 'idempotency_key'],
    ['direct', createMessageChatsSchema, 'operation_id'],
  ] as const)(
    'documents reuse of the returned identity for safe retry on %s',
    (_, schema, identityProperty) => {
      const properties = schema.body.properties as unknown as Record<
        string,
        { description?: string }
      >;
      expect(properties[identityProperty]?.description).toContain(
        'retry seguro'
      );
      expect(schema.description).toContain('retry seguro');
    }
  );

  it('documents safe retry for the optional legacy delete body', () => {
    expect(
      deleteMessageBodySchema.properties.operation_id.description
    ).toContain('retry seguro');
    expect(deleteMessageSchema.description).toContain('retry seguro');
    expect(deleteMessageSchema.body.description).toContain(
      'Corpo inteiro opcional'
    );
  });

  it.each([
    ['reaction', reactMessageSchema],
    ['delete', deleteMessageSchema],
    ['edit', editMessageSchema],
    ['forward', forwardMessageSchema],
    ['direct', createMessageChatsSchema],
  ] as const)(
    'documents PubAck unknown and terminal retry for %s',
    (_, schema) => {
      expect(schema.response[503]).toBeDefined();
      expect(schema.response[410]).toBeDefined();
    }
  );
});

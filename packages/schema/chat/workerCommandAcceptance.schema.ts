import { Type } from '@sinclair/typebox';

export const workerCommandPublishReceiptSchema = Type.Object({
  command_id: Type.String(),
  operation_id: Type.String(),
  stream: Type.String(),
  stream_sequence: Type.Number(),
  duplicate: Type.Boolean(),
  accepted_at: Type.String({ format: 'date-time' }),
  expires_at: Type.String({ format: 'date-time' }),
});

export const workerCommandAcceptedCommandsSchema = Type.Optional(
  Type.Array(workerCommandPublishReceiptSchema)
);

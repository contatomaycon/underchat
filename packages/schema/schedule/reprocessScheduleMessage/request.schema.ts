import { Static, Type } from '@sinclair/typebox';

export const reprocessScheduleMessageParamsRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});

export type ReprocessScheduleMessageParamsRequest = Static<
  typeof reprocessScheduleMessageParamsRequestSchema
>;

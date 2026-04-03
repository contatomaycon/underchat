import { Static, Type } from '@sinclair/typebox';

export const reprocessScheduleFailedParamsRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
});

export type ReprocessScheduleFailedParamsRequest = Static<
  typeof reprocessScheduleFailedParamsRequestSchema
>;

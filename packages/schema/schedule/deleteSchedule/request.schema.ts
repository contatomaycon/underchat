import { Static, Type } from '@sinclair/typebox';

export const deleteScheduleRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
});

export type DeleteScheduleRequest = Static<typeof deleteScheduleRequestSchema>;

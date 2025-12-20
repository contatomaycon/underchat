import { Static, Type } from '@sinclair/typebox';

export const viewScheduleRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
});

export type ViewScheduleRequest = Static<typeof viewScheduleRequestSchema>;

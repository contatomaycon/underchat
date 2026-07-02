import { Static, Type } from '@sinclair/typebox';

export const scheduleOfficialTemplatesRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type ScheduleOfficialTemplatesRequest = Static<
  typeof scheduleOfficialTemplatesRequestSchema
>;

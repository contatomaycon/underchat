import { Static, Type } from '@sinclair/typebox';

export const viewSimultaneousAttendanceParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewSimultaneousAttendanceParams = Static<
  typeof viewSimultaneousAttendanceParamsSchema
>;

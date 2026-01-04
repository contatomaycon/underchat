import { Static, Type } from '@sinclair/typebox';

export const updateSimultaneousAttendanceParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateSimultaneousAttendanceRequestSchema = Type.Object({
  quantity: Type.Optional(Type.Integer({ minimum: 1 })),
  enabled: Type.Boolean(),
});

export type UpdateSimultaneousAttendanceParams = Static<
  typeof updateSimultaneousAttendanceParamsSchema
>;
export type UpdateSimultaneousAttendanceRequest = Static<
  typeof updateSimultaneousAttendanceRequestSchema
>;

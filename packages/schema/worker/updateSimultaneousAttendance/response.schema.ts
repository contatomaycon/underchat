import { Static, Type } from '@sinclair/typebox';

export const updateSimultaneousAttendanceResponseSchema = Type.Object({
  simultaneous_attendance: Type.Union([Type.Integer(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateSimultaneousAttendanceResponse = Static<
  typeof updateSimultaneousAttendanceResponseSchema
>;

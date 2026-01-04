import { Static, Type } from '@sinclair/typebox';

export const viewSimultaneousAttendanceResponseSchema = Type.Object({
  simultaneous_attendance: Type.Union([Type.Integer(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewSimultaneousAttendanceResponse = Static<
  typeof viewSimultaneousAttendanceResponseSchema
>;

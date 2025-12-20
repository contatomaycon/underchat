import { Static, Type } from '@sinclair/typebox';

export const listScheduleContactGroupsResponseSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listScheduleContactGroupsFinalResponseSchema = Type.Array(
  listScheduleContactGroupsResponseSchema
);

export type ListScheduleContactGroupsResponse = Static<
  typeof listScheduleContactGroupsResponseSchema
>;
export type ListScheduleContactGroupsFinalResponse = Static<
  typeof listScheduleContactGroupsFinalResponseSchema
>;

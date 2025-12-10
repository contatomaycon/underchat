import { Static, Type } from '@sinclair/typebox';

export const deleteContactGroupRequestSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
});

export type DeleteContactGroupRequest = Static<
  typeof deleteContactGroupRequestSchema
>;

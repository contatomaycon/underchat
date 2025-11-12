import { Static, Type } from '@sinclair/typebox';

export const listContactGroupAllResponseSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListContactGroupAllResponse = Static<
  typeof listContactGroupAllResponseSchema
>;

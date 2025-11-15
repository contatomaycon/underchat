import { Static, Type } from '@sinclair/typebox';

export const viewContactGroupRequestSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
});

export type ViewContactGroupRequest = Static<
  typeof viewContactGroupRequestSchema
>;

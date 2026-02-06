import { Static, Type } from '@sinclair/typebox';

export const viewContactChannelsByContactIdParamsRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewContactChannelsByContactIdParamsRequest = Static<
  typeof viewContactChannelsByContactIdParamsRequestSchema
>;

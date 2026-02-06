import { Static, Type } from '@sinclair/typebox';

export const viewContactChannelsByContactIdResponseSchema = Type.Array(
  Type.String({ format: 'uuid' })
);

export type ViewContactChannelsByContactIdResponse = Static<
  typeof viewContactChannelsByContactIdResponseSchema
>;

import { Static, Type } from '@sinclair/typebox';

export const viewUserChannelsResponseSchema = Type.Array(
  Type.String({ format: 'uuid' })
);

export type ViewUserChannelsResponse = Static<
  typeof viewUserChannelsResponseSchema
>;

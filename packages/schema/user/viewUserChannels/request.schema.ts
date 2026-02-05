import { Static, Type } from '@sinclair/typebox';

export const viewUserChannelsParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserChannelsParamsRequest = Static<
  typeof viewUserChannelsParamsRequestSchema
>;

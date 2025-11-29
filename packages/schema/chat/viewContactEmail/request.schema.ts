import { Static, Type } from '@sinclair/typebox';

export const viewChatContactEmailParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewChatContactEmailParams = Static<
  typeof viewChatContactEmailParamsSchema
>;

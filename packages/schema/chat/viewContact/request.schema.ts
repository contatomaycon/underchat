import { Static, Type } from '@sinclair/typebox';

export const viewChatContactParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewChatContactParams = Static<typeof viewChatContactParamsSchema>;

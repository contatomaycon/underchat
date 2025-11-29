import { Static, Type } from '@sinclair/typebox';

export const viewChatContactPhoneParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewChatContactPhoneParams = Static<
  typeof viewChatContactPhoneParamsSchema
>;

import { Static, Type } from '@sinclair/typebox';

export const viewInternalChatContactPhoneParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});
export const viewInternalChatContactPhoneQuerySchema = Type.Object({});
export const viewInternalChatContactPhoneBodySchema = Type.Object({});

export type ViewInternalChatContactPhoneParams = Static<
  typeof viewInternalChatContactPhoneParamsSchema
>;

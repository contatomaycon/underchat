import { Static, Type } from '@sinclair/typebox';

export const viewChatContactChannelsByContactIdParamsRequestSchema =
  Type.Object({
    contact_id: Type.String({ format: 'uuid' }),
  });

export type ViewChatContactChannelsByContactIdParamsRequest = Static<
  typeof viewChatContactChannelsByContactIdParamsRequestSchema
>;

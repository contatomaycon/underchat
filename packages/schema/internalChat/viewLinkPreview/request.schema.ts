import { Static, Type } from '@sinclair/typebox';

export const viewInternalChatLinkPreviewParamsSchema = Type.Object({});
export const viewInternalChatLinkPreviewQuerySchema = Type.Object({});
export const viewInternalChatLinkPreviewBodySchema = Type.Object({
  url: Type.String(),
});

export type ViewInternalChatLinkPreviewBody = Static<
  typeof viewInternalChatLinkPreviewBodySchema
>;

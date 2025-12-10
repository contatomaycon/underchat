import { Static, Type } from '@sinclair/typebox';

export const viewLinkPreviewBodySchema = Type.Object({
  url: Type.String(),
});

export type ViewLinkPreviewBody = Static<typeof viewLinkPreviewBodySchema>;

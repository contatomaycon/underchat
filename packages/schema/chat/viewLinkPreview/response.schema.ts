import { Static, Type } from '@sinclair/typebox';

export const viewLinkPreviewResponseSchema = Type.Object({
  'canonical-url': Type.Optional(Type.Union([Type.String(), Type.Null()])),
  'matched-text': Type.Optional(Type.Union([Type.String(), Type.Null()])),
  title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  jpegThumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  highQualityThumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  originalThumbnailUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewLinkPreviewResponse = Static<
  typeof viewLinkPreviewResponseSchema
>;

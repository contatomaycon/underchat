import { Static, Type } from '@sinclair/typebox';

export const viewInternalChatLinkPreviewDataSchema = Type.Object(
  {
    'canonical-url': Type.Optional(Type.Union([Type.String(), Type.Null()])),
    'matched-text': Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    jpegThumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    highQualityThumbnail: Type.Optional(
      Type.Union([Type.String(), Type.Null()])
    ),
    originalThumbnailUrl: Type.Optional(
      Type.Union([Type.String(), Type.Null()])
    ),
  },
  { additionalProperties: true }
);

export const viewInternalChatLinkPreviewResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: viewInternalChatLinkPreviewDataSchema,
});

export type ViewInternalChatLinkPreviewResponse = Static<
  typeof viewInternalChatLinkPreviewResponseSchema
>;

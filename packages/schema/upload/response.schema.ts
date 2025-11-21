import { Static, Type } from '@sinclair/typebox';

export const uploadFileResponseSchema = Type.Object({
  url: Type.String(),
  name: Type.String(),
  extension: Type.String(),
  size: Type.Number(),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UploadFileResponse = Static<typeof uploadFileResponseSchema>;

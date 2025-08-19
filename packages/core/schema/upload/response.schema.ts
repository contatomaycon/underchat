import { Static, Type } from '@sinclair/typebox';

export const uploadFileResponseSchema = Type.Object({
  url: Type.String(),
  name: Type.String(),
  extension: Type.String(),
  size: Type.Number(),
});

export type UploadFileResponse = Static<typeof uploadFileResponseSchema>;

import { Static, Type } from '@sinclair/typebox';

export const uploadFileRequestSchema = Type.Object({
  type: Type.Optional(Type.String()),
  filename: Type.String(),
  encoding: Type.String(),
  mimetype: Type.Optional(Type.String()),
  file: Type.Any(),
  toBuffer: Type.Any(),
});

export type UploadFileRequest = Static<typeof uploadFileRequestSchema>;

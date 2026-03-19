import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const uploadNfseCertificateRequestSchema = Type.Object({
  certificate: uploadFileRequestSchema,
  certificate_password: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
});

export type UploadNfseCertificateRequest = Static<
  typeof uploadNfseCertificateRequestSchema
>;

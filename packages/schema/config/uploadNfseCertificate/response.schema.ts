import {
  updateNfseResponseSchema,
  UpdateNfseResponse,
} from '@core/schema/config/updateNfse/response.schema';

export const uploadNfseCertificateResponseSchema = updateNfseResponseSchema;

export type UploadNfseCertificateResponse = UpdateNfseResponse;

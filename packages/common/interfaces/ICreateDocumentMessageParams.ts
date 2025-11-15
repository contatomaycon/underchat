import { ICreateMessageParams } from './ICreateMessageParams';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

export interface ICreateDocumentMessageParams extends ICreateMessageParams {
  documentData: UploadFileResponse;
  hash: string | null;
}


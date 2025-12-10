import { UploadFileRequest } from '@core/schema/upload/request.schema';

export type IUploadFileInput =
  | UploadFileRequest
  | UploadFileRequest[]
  | null
  | undefined;

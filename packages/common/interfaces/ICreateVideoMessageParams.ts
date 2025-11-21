import { ICreateMessageParams } from './ICreateMessageParams';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

export interface ICreateVideoMessageParams extends ICreateMessageParams {
  videoData: UploadFileResponse;
  videoDuration: number | null;
}

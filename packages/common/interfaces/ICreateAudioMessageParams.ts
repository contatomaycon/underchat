import { ICreateMessageParams } from './ICreateMessageParams';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

export interface ICreateAudioMessageParams extends ICreateMessageParams {
  audioData: UploadFileResponse;
  duration: number | null;
  isViewOnce: boolean;
  isPtt: boolean;
}

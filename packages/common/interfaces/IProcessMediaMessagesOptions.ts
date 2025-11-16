import { IProcessMediaMessagesParams } from './IProcessMediaMessagesParams';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

export interface IProcessMediaMessagesOptions
  extends IProcessMediaMessagesParams {
  documents: UploadFileRequest[];
  videos: UploadFileRequest[];
  videoDuration: number | null;
  audios: UploadFileRequest[];
  audioDuration: number | null;
  audioViewOnce: boolean;
  audioPtt: boolean;
}

import { ETypeUserChat } from '../enums/ETypeUserChat';
import { ICreateMessageParams } from './ICreateMessageParams';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

export interface ICreateImageMessageParams extends ICreateMessageParams {
  imageData: UploadFileResponse;
  hash: string | null;
  typeUser: ETypeUserChat;
}

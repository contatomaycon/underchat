import { IChat } from './IChat';
import { EMessageType } from '../enums/EMessageType';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { TSecurityKeyScope } from './ISecurityKeyConfig';
import { IOfficialWhatsappOutboundInteractiveMessage } from './IOfficialWhatsappOutboundMessage';

export interface ISendMessageOptions {
  chat: IChat;
  accountId: string;
  type: EMessageType;
  message?: string | null;
  messageQuotedId?: string | null;
  hash?: string | null;
  typeUser: ETypeUserChat;
  senderName?: string | null;
  senderUser?: IChat['user'] | null;
  linkPreview?: any;
  securityKeyScopes?: TSecurityKeyScope[];
}

export interface ISendTextMessageOptions extends ISendMessageOptions {
  type: EMessageType.text | EMessageType.system | EMessageType.annotation;
  annotationSubtype?: 'closure' | 'closure_audit';
}

export interface ISendImageMessageOptions extends ISendMessageOptions {
  type: EMessageType.image;
  images?: UploadFileRequest[];
  imageUrl?: string | null;
  imageMimetype?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export interface ISendVideoMessageOptions extends ISendMessageOptions {
  type: EMessageType.video;
  videos?: UploadFileRequest[];
  videoUrl?: string | null;
  videoMimetype?: string | null;
  videoDuration?: number | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
}

export interface ISendAudioMessageOptions extends ISendMessageOptions {
  type: EMessageType.audio;
  audios?: UploadFileRequest[];
  audioUrl?: string | null;
  audioMimetype?: string | null;
  audioDuration?: number | null;
  audioPtt?: boolean;
  audioViewOnce?: boolean;
}

export interface ISendDocumentMessageOptions extends ISendMessageOptions {
  type: EMessageType.document;
  documents?: UploadFileRequest[];
  documentUrl?: string | null;
  documentMimetype?: string | null;
}

export interface ISendLocationMessageOptions extends ISendMessageOptions {
  type: EMessageType.location;
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}

export interface ISendContactMessageOptions extends ISendMessageOptions {
  type: EMessageType.contact_card;
  contactIds: string[];
}

export interface ISendOfficialInteractiveMessageOptions extends ISendMessageOptions {
  type: EMessageType.official_interactive;
  officialInteractive: IOfficialWhatsappOutboundInteractiveMessage;
}

export type SendMessageOptions =
  | ISendTextMessageOptions
  | ISendImageMessageOptions
  | ISendVideoMessageOptions
  | ISendAudioMessageOptions
  | ISendDocumentMessageOptions
  | ISendLocationMessageOptions
  | ISendContactMessageOptions
  | ISendOfficialInteractiveMessageOptions;

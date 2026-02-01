export interface IVoiceIaGenerateSpeechResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
}

export interface IVoiceIaGenerateSpeechAndUploadResult {
  url: string;
  mimetype: string;
}

export interface IVoiceIaTranscribeResult {
  text: string;
}

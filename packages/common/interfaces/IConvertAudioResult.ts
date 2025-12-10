export interface IConvertAudioResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  duration?: number;
}

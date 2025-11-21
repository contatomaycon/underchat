export interface IConvertVideoResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  duration?: number;
  width?: number;
  height?: number;
}

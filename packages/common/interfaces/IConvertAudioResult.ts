export interface IConvertAudioResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  duration?: number;
  probe?: {
    format_name: string | null;
    format_duration: string | null;
    format_start_time: string | null;
    format_bit_rate: string | null;
    codec_name: string | null;
    channels: number | null;
    sample_rate: number | null;
    stream_duration: string | null;
    stream_start_time: string | null;
    stream_bit_rate: string | null;
  };
}

export interface IConvertVideoResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  duration?: number;
  width?: number;
  height?: number;
  probe?: {
    format_name: string | null;
    format_duration: string | null;
    format_start_time: string | null;
    format_bit_rate: string | null;
    video_codec_name: string | null;
    video_width: number | null;
    video_height: number | null;
    video_pix_fmt: string | null;
    video_duration: string | null;
    video_start_time: string | null;
    video_bit_rate: string | null;
    audio_codec_name: string | null;
    audio_channels: number | null;
    audio_sample_rate: number | null;
    audio_duration: string | null;
    audio_start_time: string | null;
    audio_bit_rate: string | null;
  };
}

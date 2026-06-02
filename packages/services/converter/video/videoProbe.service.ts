import { injectable } from 'tsyringe';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@injectable()
export class VideoProbeService {
  async probeMetadata(filePath: string): Promise<any> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt,channels,sample_rate',
      '-of',
      'json',
      filePath,
    ]);
    return JSON.parse(stdout);
  }

  extractDuration(probeData: any): number | undefined {
    const format = probeData.format;
    if (!format?.duration) {
      return undefined;
    }

    const parsedDuration = Number.parseFloat(format.duration);
    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      return Math.round(parsedDuration);
    }

    return undefined;
  }

  extractDimensions(probeData: any): { width?: number; height?: number } {
    const videoStream = probeData.streams?.find(
      (stream: any) => stream.codec_type === 'video'
    );

    if (!videoStream) {
      return {};
    }

    const width = videoStream.width
      ? Number.parseInt(videoStream.width, 10)
      : undefined;
    const height = videoStream.height
      ? Number.parseInt(videoStream.height, 10)
      : undefined;

    return {
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    };
  }

  async probeDuration(filePath: string): Promise<number | undefined> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const durationStr = stdout.trim();
      if (durationStr) {
        const parsedDuration = Number.parseFloat(durationStr);
        if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
          return Math.round(parsedDuration);
        }
      }
    } catch {}

    return undefined;
  }
}

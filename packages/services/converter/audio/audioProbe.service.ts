import { injectable } from 'tsyringe';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@injectable()
export class AudioProbeService {
  async probeMetadata(filePath: string): Promise<any> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,channels,sample_rate,bit_rate',
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

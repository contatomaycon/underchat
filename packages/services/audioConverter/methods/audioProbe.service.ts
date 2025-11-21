import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class AudioProbeService {
  async probeMetadata(filePath: string): Promise<any> {
    const probeCommand = [
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration,stream=codec_name,stream=channels,stream=sample_rate,stream=bit_rate',
      '-of',
      'json',
      `"${filePath}"`,
    ].join(' ');

    const { stdout } = await execAsync(probeCommand);
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
      const probeCommand = [
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        `"${filePath}"`,
      ].join(' ');

      const { stdout } = await execAsync(probeCommand);
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

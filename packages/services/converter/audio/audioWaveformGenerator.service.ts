import { injectable } from 'tsyringe';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { FileUtils } from './fileUtils.service';

@injectable()
export class AudioWaveformGenerator {
  async generate(audioBuffer: Buffer): Promise<string | undefined> {
    const inputRandomId = randomBytes(8).toString('hex');
    const outputRandomId = randomBytes(8).toString('hex');

    const inputPath = join(
      tmpdir(),
      `audio-waveform-input-${Date.now()}-${inputRandomId}.aac`
    );

    const pcmPath = join(
      tmpdir(),
      `audio-waveform-pcm-${Date.now()}-${outputRandomId}.pcm`
    );

    try {
      await writeFile(inputPath, audioBuffer);
      await this.convertToPcm(inputPath, pcmPath);
      const waveform = await this.processPcmData(pcmPath);

      if (!waveform) {
        return undefined;
      }

      return Buffer.from(waveform).toString('base64');
    } catch (error) {
      console.error('Failed to generate waveform with ffmpeg:', error);
      return undefined;
    } finally {
      await FileUtils.safeUnlink(inputPath);
      await FileUtils.safeUnlink(pcmPath);
    }
  }

  private async convertToPcm(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .format('s16le')
        .audioCodec('pcm_s16le')
        .audioFrequency(44100)
        .audioChannels(1)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  private async processPcmData(
    pcmPath: string
  ): Promise<Uint8Array | undefined> {
    const pcmData = await readFile(pcmPath);

    const samples = 64;
    const blockSize = Math.floor(pcmData.length / 2 / samples);
    const filteredData: number[] = [];

    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i * 2;
      let sum = 0;

      for (let j = 0; j < blockSize; j++) {
        const byteOffset = blockStart + j * 2;
        if (byteOffset + 1 < pcmData.length) {
          const sample = pcmData.readInt16LE(byteOffset);
          const normalized = sample / 32768.0;
          sum += Math.abs(normalized);
        }
      }

      filteredData.push(sum / blockSize);
    }

    const maxValue = Math.max(...filteredData);
    if (maxValue <= 0) {
      return undefined;
    }

    const multiplier = 1.0 / maxValue;
    const normalizedData = filteredData.map((n) => n * multiplier);

    return new Uint8Array(normalizedData.map((n) => Math.floor(100 * n)));
  }
}

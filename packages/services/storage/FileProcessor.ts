import { extension as mimeToExt } from 'mime-types';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { v7 as uuidv7 } from 'uuid';

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  mimetype: string | null;
}

export class FileProcessor {
  normalizeFilename(filename: string): string {
    return filename.replaceAll(' ', '_');
  }

  getFileExtension(name: string): string {
    const match = /\.([^./\\]+)$/.exec(name);
    return match ? match[1].toLowerCase() : '';
  }

  extFromMime(mime: string): string | null {
    const clean = (mime ?? '').toLowerCase().split(';')[0].trim();
    return (mimeToExt(clean) as string) ?? null;
  }

  determineBaseName(
    providedName: string | null | undefined,
    providedExt: string | null | undefined,
    ext: string,
    accountId: string
  ): string {
    if (!providedName) {
      return `${accountId}-${Date.now()}.${ext}`;
    }

    if (providedExt) {
      return providedName;
    }

    return `${providedName}.${ext}`;
  }

  normalizeFileNameWithExtension(filename: string, extension: string): string {
    if (filename.endsWith(`.${extension}`)) {
      return filename;
    }
    return `${filename}.${extension}`;
  }

  async extractImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(buffer).metadata();
      const width = metadata.width ?? null;
      const height = metadata.height ?? null;
      let mimetype: string | null = null;

      if (metadata.format) {
        mimetype = `image/${metadata.format}`;
      }

      return { width, height, mimetype };
    } catch {
      return { width: null, height: null, mimetype: null };
    }
  }

  async detectFileType(buffer: Buffer): Promise<{
    ext: string | undefined;
    mime: string | undefined;
  }> {
    const fileType = await fileTypeFromBuffer(buffer).catch(() => null);
    return {
      ext: fileType?.ext,
      mime: fileType?.mime,
    };
  }

  generateUniqueFilename(extension: string): string {
    return `${uuidv7()}.${extension}`;
  }

  parseDispositionFilename(disposition?: string | null): string {
    if (!disposition) {
      return '';
    }

    const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(disposition);
    const simpleMatch = /filename\s*=\s*([^;]+)/i.exec(disposition);
    const simple = quotedMatch?.[1] ?? simpleMatch?.[1];

    return simple?.trim() ?? '';
  }

  extractFilenameFromUrl(url: string): string {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    while (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const last = pathname.slice(pathname.lastIndexOf('/') + 1);
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
}

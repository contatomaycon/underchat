import { injectable } from 'tsyringe';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';

export type TPromptDocumentExtractionSource =
  | 'text'
  | 'json'
  | 'markdown'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'fallback';

export interface IPromptDocumentExtractionResult {
  text: string;
  contentType: string | null;
  source: TPromptDocumentExtractionSource;
}

@injectable()
export class PromptDocumentExtractorService {
  private readonly DEFAULT_TIMEOUT_MS = 20000;

  async extractTextFromUrl(
    fileUrl: string,
    options?: {
      timeoutMs?: number;
      allowLegacyOfficeFormats?: boolean;
    }
  ): Promise<IPromptDocumentExtractionResult> {
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const allowLegacyOfficeFormats = options?.allowLegacyOfficeFormats ?? true;
    const response = await this.fetchWithTimeout(fileUrl, timeoutMs);

    if (!response.ok) {
      throw new Error(`Falha ao baixar arquivo: ${response.status}`);
    }

    const contentType = this.normalizeContentType(
      response.headers.get('content-type')
    );
    const extension = this.getExtensionFromUrl(fileUrl);
    const buffer = await response.arrayBuffer();

    return this.extractTextFromBuffer(buffer, contentType, extension, {
      allowLegacyOfficeFormats,
    });
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractTextFromBuffer(
    buffer: ArrayBuffer,
    contentType: string | null,
    extension: string | null,
    options: { allowLegacyOfficeFormats: boolean }
  ): Promise<IPromptDocumentExtractionResult> {
    if (this.isPlainTextContent(contentType, extension)) {
      return {
        text: this.decodeText(buffer),
        contentType,
        source: this.resolveTextSource(contentType, extension),
      };
    }

    if (this.isJsonContent(contentType, extension)) {
      return {
        text: this.extractJson(buffer),
        contentType,
        source: 'json',
      };
    }

    if (
      options.allowLegacyOfficeFormats &&
      this.isPdfContent(contentType, extension)
    ) {
      return {
        text: await this.extractTextFromPdf(buffer),
        contentType,
        source: 'pdf',
      };
    }

    if (
      options.allowLegacyOfficeFormats &&
      this.isDocxContent(contentType, extension)
    ) {
      return {
        text: await this.extractTextFromDocx(buffer),
        contentType,
        source: 'docx',
      };
    }

    if (
      options.allowLegacyOfficeFormats &&
      this.isDocContent(contentType, extension)
    ) {
      return {
        text: await this.extractTextFromDoc(buffer),
        contentType,
        source: 'doc',
      };
    }

    const fallbackText = this.decodeText(buffer);
    if (this.isProbablyText(fallbackText)) {
      return {
        text: fallbackText,
        contentType,
        source: 'fallback',
      };
    }

    throw new Error(
      `Tipo de arquivo não suportado para extração: ${contentType ?? extension ?? 'desconhecido'}`
    );
  }

  private normalizeContentType(contentType: string | null): string | null {
    if (!contentType) {
      return null;
    }
    return contentType.split(';')[0].trim().toLowerCase();
  }

  private getExtensionFromUrl(fileUrl: string): string | null {
    try {
      const pathname = new URL(fileUrl).pathname;
      const basename = pathname.split('/').pop() ?? '';
      const dotIndex = basename.lastIndexOf('.');
      if (dotIndex > 0 && dotIndex < basename.length - 1) {
        return basename.slice(dotIndex).toLowerCase();
      }
    } catch {
      return null;
    }

    return null;
  }

  private decodeText(buffer: ArrayBuffer): string {
    return new TextDecoder().decode(buffer).trim();
  }

  private extractJson(buffer: ArrayBuffer): string {
    const text = this.decodeText(buffer);
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(parsed, null, 2);
  }

  private isPlainTextContent(
    contentType: string | null,
    extension: string | null
  ): boolean {
    if (
      contentType === 'text/plain' ||
      contentType === 'text/markdown' ||
      contentType === 'text/csv' ||
      contentType === 'text/tab-separated-values'
    ) {
      return true;
    }

    return (
      extension === '.txt' ||
      extension === '.md' ||
      extension === '.markdown' ||
      extension === '.csv' ||
      extension === '.tsv'
    );
  }

  private isJsonContent(
    contentType: string | null,
    extension: string | null
  ): boolean {
    return contentType === 'application/json' || extension === '.json';
  }

  private isPdfContent(
    contentType: string | null,
    extension: string | null
  ): boolean {
    return contentType === 'application/pdf' || extension === '.pdf';
  }

  private isDocxContent(
    contentType: string | null,
    extension: string | null
  ): boolean {
    return (
      contentType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      extension === '.docx'
    );
  }

  private isDocContent(
    contentType: string | null,
    extension: string | null
  ): boolean {
    return contentType === 'application/msword' || extension === '.doc';
  }

  private resolveTextSource(
    contentType: string | null,
    extension: string | null
  ): TPromptDocumentExtractionSource {
    if (
      contentType === 'text/markdown' ||
      extension === '.md' ||
      extension === '.markdown'
    ) {
      return 'markdown';
    }

    if (
      contentType === 'text/csv' ||
      contentType === 'text/tab-separated-values' ||
      extension === '.csv' ||
      extension === '.tsv'
    ) {
      return 'csv';
    }

    return 'text';
  }

  private isProbablyText(text: string): boolean {
    if (!text) {
      return false;
    }

    const sample = text.slice(0, 1200);
    const nonPrintable = sample.replace(/[\x09\x0A\x0D\x20-\x7E]/g, '');
    const ratio = nonPrintable.length / sample.length;
    return ratio < 0.2;
  }

  private async extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }

  private async extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
    const parser = new PDFParse({ data: Buffer.from(buffer) });
    try {
      const result = await parser.getText();
      return (result?.text ?? '').trim();
    } finally {
      await parser.destroy();
    }
  }

  private async extractTextFromDoc(buffer: ArrayBuffer): Promise<string> {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(Buffer.from(buffer));
    return extracted.getBody().trim();
  }
}

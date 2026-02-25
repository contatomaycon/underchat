import { s3Environment } from '@core/config/environments';

export interface ParsedS3Url {
  accountId: string;
  key: string;
}

export class S3UrlParser {
  parse(url: string): ParsedS3Url | null {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return null;
    }

    try {
      let urlToParse = url.trim();
      const endpointUrl = s3Environment.s3Endpoint.replace(/\/$/, '');

      if (urlToParse.startsWith(endpointUrl)) {
        urlToParse = urlToParse.replace(endpointUrl, '');
      }

      const parsedFromUrl = this.parseFromUrl(urlToParse);
      if (parsedFromUrl) {
        return parsedFromUrl;
      }

      const parsedFromPath = this.parseFromPath(urlToParse);
      if (parsedFromPath) {
        return parsedFromPath;
      }

      return null;
    } catch {
      return null;
    }
  }

  private parseFromUrl(urlToParse: string): ParsedS3Url | null {
    try {
      const urlObj = new URL(
        urlToParse.startsWith('http')
          ? urlToParse
          : `https://example.com${urlToParse}`
      );
      let pathname = urlObj.pathname;

      if (pathname.startsWith('/')) {
        pathname = pathname.substring(1);
      }

      const pathParts = pathname
        .split('/')
        .filter((part) => part !== '' && part.trim() !== '');

      return this.parsePathParts(pathParts);
    } catch {
      return null;
    }
  }

  private parseFromPath(urlToParse: string): ParsedS3Url | null {
    if (!urlToParse.startsWith('/')) {
      urlToParse = `/${urlToParse}`;
    }

    const pathParts = urlToParse
      .split('/')
      .filter((part) => part !== '' && part.trim() !== '');

    return this.parsePathParts(pathParts);
  }

  private parsePathParts(pathParts: string[]): ParsedS3Url | null {
    if (pathParts.length < 2) {
      return null;
    }

    const firstSegment = pathParts[0].trim();
    const remainingKeyParts = pathParts
      .slice(1)
      .map((part) => part.trim())
      .filter((part) => part !== '');

    if (!firstSegment || remainingKeyParts.length === 0) {
      return null;
    }

    if (firstSegment.includes(':')) {
      return this.parseLegacyFormat(firstSegment, remainingKeyParts);
    }

    return this.buildParsedS3Url(firstSegment, remainingKeyParts);
  }

  private parseLegacyFormat(
    firstSegment: string,
    remainingKeyParts: string[]
  ): ParsedS3Url | null {
    const colonIndex = firstSegment.indexOf(':');
    if (colonIndex <= 0 || colonIndex >= firstSegment.length - 1) {
      return null;
    }

    const accountId = firstSegment.slice(0, colonIndex).trim();
    const legacyKeyPrefix = firstSegment.slice(colonIndex + 1).trim();

    if (!accountId || !legacyKeyPrefix) {
      return null;
    }

    return this.buildParsedS3Url(accountId, [
      legacyKeyPrefix,
      ...remainingKeyParts,
    ]);
  }

  private buildParsedS3Url(
    accountId: string,
    keyParts: string[]
  ): ParsedS3Url | null {
    const normalizedAccountId = accountId.trim();
    const normalizedKey = keyParts.join('/').trim();

    if (
      !normalizedAccountId ||
      !normalizedKey ||
      normalizedAccountId.length === 0 ||
      normalizedKey.length === 0
    ) {
      return null;
    }

    if (
      normalizedAccountId.includes(':') ||
      normalizedAccountId.includes('.')
    ) {
      return null;
    }

    return {
      accountId: normalizedAccountId,
      key: normalizedKey,
    };
  }
}

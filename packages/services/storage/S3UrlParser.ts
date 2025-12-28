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

      if (pathParts.length >= 2) {
        const accountId = pathParts[0].trim();
        const key = pathParts.slice(1).join('/').trim();

        if (accountId && key && accountId.length > 0 && key.length > 0) {
          return { accountId, key };
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private parseFromPath(urlToParse: string): ParsedS3Url | null {
    if (!urlToParse.startsWith('/')) {
      urlToParse = `/${urlToParse}`;
    }

    const pathParts = urlToParse
      .split('/')
      .filter((part) => part !== '' && part.trim() !== '');

    if (pathParts.length < 2) {
      return null;
    }

    const accountId = pathParts[0].trim();
    const key = pathParts.slice(1).join('/').trim();

    if (!accountId || !key || accountId.length === 0 || key.length === 0) {
      return null;
    }

    if (accountId.includes(':') || accountId.includes('.')) {
      return null;
    }

    return { accountId, key };
  }
}

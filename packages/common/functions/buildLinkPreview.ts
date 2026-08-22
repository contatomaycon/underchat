import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { getPreviewFromContent } from 'link-preview-js';
import sharp from 'sharp';
import type { WAUrlInfo } from '@whiskeysockets/baileys';

const PAGE_LIMIT_BYTES = 1024 * 1024;
const IMAGE_LIMIT_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 8_192;

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

interface SafeResource {
  body: Buffer;
  headers: IncomingHttpHeaders;
  statusCode: number;
  url: string;
}

export function isBlockedLinkPreviewAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return blockedIpv4Addresses.check(address, 'ipv4');
  if (family === 6) return blockedIpv6Addresses.check(address, 'ipv6');

  return true;
}

function hostnameWithoutBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export function validateLinkPreviewUrl(value: string): URL {
  if (value.length > MAX_URL_LENGTH) {
    throw new Error('link_preview_url_too_long');
  }

  const url = new URL(value);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('unsupported_link_preview_protocol');
  }

  if (url.username || url.password) {
    throw new Error('link_preview_credentials_not_allowed');
  }

  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw new Error('link_preview_port_not_allowed');
  }

  const hostname = hostnameWithoutBrackets(url.hostname);
  const hostnameWithoutTrailingDot = hostname.replace(/\.+$/, '');

  if (
    !hostnameWithoutTrailingDot ||
    hostnameWithoutTrailingDot === 'localhost' ||
    hostnameWithoutTrailingDot.endsWith('.localhost') ||
    hostnameWithoutTrailingDot.endsWith('.local')
  ) {
    throw new Error('link_preview_host_not_allowed');
  }

  if (
    isIP(hostnameWithoutTrailingDot) &&
    isBlockedLinkPreviewAddress(hostnameWithoutTrailingDot)
  ) {
    throw new Error('link_preview_private_address');
  }

  return url;
}

function requestedAddressFamily(
  family: LookupOptions['family']
): number | undefined {
  if (family === 'IPv4') return 4;
  if (family === 'IPv6') return 6;
  if (family === 4 || family === 6) return family;
  return undefined;
}

const secureLookup: LookupFunction = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
) => {
  lookup(hostname, { all: true, order: 'verbatim' }, (error, records) => {
    if (error) {
      callback(error, []);
      return;
    }

    const addresses = records.filter(
      (record) =>
        (record.family === 4 || record.family === 6) &&
        isIP(record.address) === record.family
    );
    if (
      addresses.length === 0 ||
      addresses.some((record) => isBlockedLinkPreviewAddress(record.address))
    ) {
      callback(
        Object.assign(new Error('link_preview_private_address'), {
          code: 'EACCES',
        }),
        []
      );
      return;
    }

    const requestedFamily = requestedAddressFamily(options.family);
    const selected =
      addresses.find((record) => record.family === requestedFamily) ??
      addresses[0];

    if (options.all) {
      callback(null, addresses);
      return;
    }

    callback(null, selected.address, selected.family);
  });
};

function requestResource(
  url: URL,
  maxBytes: number,
  accept: string
): Promise<SafeResource> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let isSettled = false;
    let responseStream: IncomingMessage | undefined;
    let deadline: NodeJS.Timeout | undefined;

    const settle = (callback: () => void): void => {
      if (isSettled) return;
      isSettled = true;
      if (deadline) clearTimeout(deadline);
      callback();
    };

    const request = transport.request(
      url,
      {
        headers: {
          accept,
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'user-agent': 'Underchat-LinkPreview/1.0',
        },
        lookup: secureLookup,
        method: 'GET',
      },
      (response) => {
        responseStream = response;
        const statusCode = response.statusCode ?? 0;
        response.once('aborted', () => {
          settle(() => reject(new Error('link_preview_response_aborted')));
        });
        response.once('error', (error) => {
          settle(() => reject(error));
        });

        if (statusCode >= 300 && statusCode < 400) {
          settle(() =>
            resolve({
              body: Buffer.alloc(0),
              headers: response.headers,
              statusCode,
              url: url.href,
            })
          );
          response.destroy();
          return;
        }

        const announcedSize = Number(response.headers['content-length'] ?? 0);
        if (
          !Number.isFinite(announcedSize) ||
          announcedSize < 0 ||
          announcedSize > maxBytes
        ) {
          const error = new Error('link_preview_response_too_large');
          settle(() => reject(error));
          response.destroy(error);
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        response.on('data', (chunk: Buffer | Uint8Array) => {
          const buffer = Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > maxBytes) {
            const error = new Error('link_preview_response_too_large');
            settle(() => reject(error));
            response.destroy(error);
            return;
          }
          chunks.push(buffer);
        });

        response.once('end', () => {
          settle(() =>
            resolve({
              body: Buffer.concat(chunks),
              headers: response.headers,
              statusCode,
              url: url.href,
            })
          );
        });
      }
    );

    deadline = setTimeout(() => {
      const error = new Error('link_preview_timeout');
      settle(() => reject(error));
      responseStream?.destroy(error);
      request.destroy(error);
    }, REQUEST_TIMEOUT_MS);

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error('link_preview_timeout');
      settle(() => reject(error));
      responseStream?.destroy(error);
      request.destroy(error);
    });
    request.once('error', (error) => {
      settle(() => reject(error));
    });
    request.end();
  });
}

async function fetchSafeResource(
  input: string,
  maxBytes: number,
  accept: string
): Promise<SafeResource> {
  let url = validateLinkPreviewUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await requestResource(url, maxBytes, accept);

    if (response.statusCode < 300 || response.statusCode >= 400) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error('link_preview_request_failed');
      }
      return response;
    }

    const location = response.headers.location;
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error('link_preview_redirect_not_allowed');
    }

    url = validateLinkPreviewUrl(new URL(location, url).href);
  }

  throw new Error('link_preview_redirect_not_allowed');
}

function headersAsStrings(
  headers: IncomingHttpHeaders
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) return [];
      return [[key, Array.isArray(value) ? value.join(', ') : String(value)]];
    })
  );
}

export async function buildLinkPreview(url: string): Promise<WAUrlInfo | null> {
  try {
    const page = await fetchSafeResource(
      url,
      PAGE_LIMIT_BYTES,
      'text/html,application/xhtml+xml;q=0.9'
    );
    const contentType = String(
      page.headers['content-type'] ?? ''
    ).toLowerCase();

    if (contentType && !contentType.includes('text/html')) return null;

    const meta = await getPreviewFromContent({
      data: page.body.toString('utf8'),
      headers: headersAsStrings(page.headers),
      status: page.statusCode,
      url: page.url,
    });

    const title = String(
      ('title' in meta && meta.title) ||
        ('siteName' in meta && meta.siteName) ||
        page.url
    ).slice(0, 500);
    const description =
      'description' in meta && meta.description
        ? String(meta.description).slice(0, 2_000)
        : undefined;
    const images =
      'images' in meta && Array.isArray(meta.images) ? meta.images : [];
    const favicons =
      'favicons' in meta && Array.isArray(meta.favicons) ? meta.favicons : [];
    const candidateImage = images[0] ?? favicons[0];

    let jpegThumbnail: Buffer | undefined;
    let originalThumbnailUrl: string | undefined;

    if (candidateImage) {
      const image = await Promise.resolve()
        .then(() => new URL(candidateImage, page.url).href)
        .then((imageUrl) =>
          fetchSafeResource(imageUrl, IMAGE_LIMIT_BYTES, 'image/*')
        )
        .catch(() => null);
      const imageContentType = String(
        image?.headers['content-type'] ?? ''
      ).toLowerCase();

      if (image && imageContentType.startsWith('image/')) {
        jpegThumbnail = await sharp(image.body, {
          limitInputPixels: 16_000_000,
        })
          .resize(96, 96, { fit: 'cover' })
          .jpeg({ quality: 60, mozjpeg: true })
          .toBuffer()
          .catch(() => undefined);

        if (jpegThumbnail) originalThumbnailUrl = image.url;
      }
    }

    return {
      'canonical-url': page.url,
      'matched-text': page.url,
      title,
      description,
      jpegThumbnail,
      originalThumbnailUrl,
    };
  } catch {
    return null;
  }
}

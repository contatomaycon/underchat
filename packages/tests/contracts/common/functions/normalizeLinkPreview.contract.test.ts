import { normalizeLinkPreview } from '@core/common/functions/normalizeLinkPreview';

describe('normalizeLinkPreview', () => {
  it('returns null for nullish input', () => {
    expect(normalizeLinkPreview(undefined)).toBeNull();
    expect(normalizeLinkPreview(null)).toBeNull();
  });

  it('normalizes string and buffer/uint8 thumbnails to base64', () => {
    const jpeg = Buffer.from('jpeg');
    const highQuality = new Uint8Array([1, 2, 3]);

    expect(
      normalizeLinkPreview({
        'canonical-url': 'https://example.com',
        'matched-text': 'example.com',
        title: 'Example',
        description: 'Desc',
        jpegThumbnail: jpeg,
        highQualityThumbnail: highQuality,
        originalThumbnailUrl: 'https://example.com/img.jpg',
      } as never)
    ).toEqual({
      'canonical-url': 'https://example.com',
      'matched-text': 'example.com',
      title: 'Example',
      description: 'Desc',
      jpegThumbnail: jpeg.toString('base64'),
      highQualityThumbnail: Buffer.from(highQuality).toString('base64'),
      originalThumbnailUrl: 'https://example.com/img.jpg',
    });
  });

  it('keeps string thumbnails and supports image-message thumbnail shape', () => {
    expect(
      normalizeLinkPreview({
        jpegThumbnail: 'already-base64',
        highQualityThumbnail: {
          jpegThumbnail: Buffer.from('hq'),
          thumbnailDirectPath: '/path',
        },
      } as never)
    ).toEqual({
      'canonical-url': null,
      'matched-text': null,
      title: null,
      description: null,
      jpegThumbnail: 'already-base64',
      highQualityThumbnail: Buffer.from('hq').toString('base64'),
      originalThumbnailUrl: null,
    });
  });

  it('returns null thumbnails for unsupported values', () => {
    expect(
      normalizeLinkPreview({
        jpegThumbnail: 123,
        highQualityThumbnail: { invalid: true },
      } as never)
    ).toEqual({
      'canonical-url': null,
      'matched-text': null,
      title: null,
      description: null,
      jpegThumbnail: null,
      highQualityThumbnail: null,
      originalThumbnailUrl: null,
    });
  });
});

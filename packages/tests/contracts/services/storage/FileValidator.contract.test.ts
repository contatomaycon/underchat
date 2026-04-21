import { FileValidator } from '@core/services/storage/FileValidator';

describe('FileValidator', () => {
  const validator = new FileValidator();

  it('validates file size limits', () => {
    expect(() => validator.validateImageSize(16 * 1024 * 1024)).not.toThrow();
    expect(() => validator.validateImageSize(16 * 1024 * 1024 + 1)).toThrow(
      'IMAGE_SIZE_LIMIT_EXCEEDED'
    );

    expect(() => validator.validateDocumentSize(100 * 1024 * 1024 + 1)).toThrow(
      'DOCUMENT_SIZE_LIMIT_EXCEEDED'
    );
    expect(() => validator.validateVideoSize(100 * 1024 * 1024 + 1)).toThrow(
      'VIDEO_SIZE_LIMIT_EXCEEDED'
    );
    expect(() => validator.validateAudioSize(16 * 1024 * 1024 + 1)).toThrow(
      'AUDIO_SIZE_LIMIT_EXCEEDED'
    );
  });

  it('validates image and video formats by extension and mimetype', () => {
    expect(() =>
      validator.validateImageFormat('jpg', 'image/jpeg')
    ).not.toThrow();
    expect(() => validator.validateImageFormat('txt', 'image/jpeg')).toThrow(
      'INVALID_IMAGE_FORMAT'
    );
    expect(() =>
      validator.validateImageFormat('png', 'application/pdf')
    ).toThrow('INVALID_IMAGE_FORMAT');

    expect(() =>
      validator.validateVideoFormat('mp4', 'video/mp4')
    ).not.toThrow();
    expect(() => validator.validateVideoFormat('exe', 'video/mp4')).toThrow(
      'INVALID_VIDEO_FORMAT'
    );
    expect(() =>
      validator.validateVideoFormat('mp4', 'application/json')
    ).toThrow('INVALID_VIDEO_FORMAT');
  });
});

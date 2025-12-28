const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 16 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const ALLOWED_IMAGE_MIMETYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];

const ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'avi', 'flv', 'mkv', 'mov', '3gp'];
const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/avi',
  'video/x-flv',
  'video/x-matroska',
  'video/quicktime',
  'video/3gpp',
];

export class FileValidator {
  validateImageSize(size: number): void {
    if (size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error('IMAGE_SIZE_LIMIT_EXCEEDED');
    }
  }

  validateDocumentSize(size: number): void {
    if (size > MAX_DOCUMENT_UPLOAD_BYTES) {
      throw new Error('DOCUMENT_SIZE_LIMIT_EXCEEDED');
    }
  }

  validateVideoSize(size: number): void {
    if (size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error('VIDEO_SIZE_LIMIT_EXCEEDED');
    }
  }

  validateAudioSize(size: number): void {
    if (size > MAX_AUDIO_UPLOAD_BYTES) {
      throw new Error('AUDIO_SIZE_LIMIT_EXCEEDED');
    }
  }

  validateImageFormat(extension: string, mimetype?: string | null): void {
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension.toLowerCase())) {
      throw new Error('INVALID_IMAGE_FORMAT');
    }

    if (mimetype && !ALLOWED_IMAGE_MIMETYPES.includes(mimetype.toLowerCase())) {
      throw new Error('INVALID_IMAGE_FORMAT');
    }
  }

  validateVideoFormat(extension: string, mimetype?: string | null): void {
    if (!ALLOWED_VIDEO_EXTENSIONS.includes(extension.toLowerCase())) {
      throw new Error('INVALID_VIDEO_FORMAT');
    }

    if (mimetype && !ALLOWED_VIDEO_MIMETYPES.includes(mimetype.toLowerCase())) {
      throw new Error('INVALID_VIDEO_FORMAT');
    }
  }
}

import type { ISelectedPhotoPreview } from '@core/common/interfaces/IChatFilePreview';

export interface ChatEditablePhotoPreview extends ISelectedPhotoPreview {
  id: string;
  originalFile: File;
  originalPreview: string;
  edited: boolean;
  cropReset?: ChatImageCropResetState | null;
}

export type ChatImageEditorTool =
  | 'crop'
  | 'filter'
  | 'draw'
  | 'text'
  | 'shape'
  | 'blur'
  | 'emoji';

export type ChatImageEditorFilter =
  | 'none'
  | 'pop'
  | 'grayscale'
  | 'cold'
  | 'chrome'
  | 'film';

export type ChatImageEditorShape = 'rect' | 'circle' | 'line' | 'arrow';

export interface ChatImageExportResult {
  file: File;
  preview: string;
  cropReset?: ChatImageCropResetState | null;
}

export interface ChatImageCropResetState {
  file: File;
  preview: string;
  edited: boolean;
}

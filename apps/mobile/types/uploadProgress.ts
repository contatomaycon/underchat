export type UploadProgressStatus = 'uploading' | 'error';

export type UploadProgressState = {
  status: UploadProgressStatus;
  progress: number;
  errorMessage?: string | null;
};

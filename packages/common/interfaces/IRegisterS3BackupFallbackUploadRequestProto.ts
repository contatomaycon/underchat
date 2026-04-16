export interface IRegisterS3BackupFallbackUploadRequestProto {
  account_id?: string;
  bucket?: string;
  object_key?: string;
  file_name?: string | null;
  content_type?: string | null;
  size_bytes?: string | number;
  primary_attempts?: number;
  backup_attempts?: number;
  primary_error?: string | null;
  backup_error?: string | null;
}

export interface ISelectedPhotoPreview {
  file: File;
  preview: string;
}

export interface ISelectedDocumentPreview {
  file: File;
  name: string;
  size: number;
  extension: string;
  type: string;
}

export interface ISelectedVideoPreview {
  file: File;
  preview: string;
  name: string;
  size: number;
  type: string;
  duration: number | null;
}

export interface ISelectedAudioPreview {
  file: File;
  preview: string;
  name: string;
  size: number;
  type: string;
  duration: number | null;
}

export interface ISelectedContactPreview {
  contact_id: string;
  name: string;
  last_name?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  email?: string | null;
  email_partial?: string | null;
}

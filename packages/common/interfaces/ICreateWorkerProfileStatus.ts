export interface ICreateWorkerProfileStatus {
  worker_id: string;
  worker_profile_status_type_id: string;
  value: string;
  is_permanent: boolean;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

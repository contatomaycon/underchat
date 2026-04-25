export type TCreateServerBuildJobInvalidReason =
  | 'invalid_build_types'
  | 'version_not_found'
  | 'build_type_exists';

export interface ICreateServerBuildJobResult {
  conflict: boolean;
  invalid_reason?: TCreateServerBuildJobInvalidReason;
  server_build_job_id?: string;
  version?: string;
}

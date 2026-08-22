export interface ILegacySessionVolumeDeleteRequestProto {
  worker_id: string;
  account_id: string;
  migration_id: string;
  volume_name: string;
}

export interface ILegacySessionVolumeDeleteResponseProto {
  worker_id: string;
  migration_id: string;
  volume_absent: boolean;
  mounted_container_count: number;
}

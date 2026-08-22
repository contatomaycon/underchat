export interface IWhatsappRuntimeFenceActivationRequestProto {
  worker_id?: string;
  account_id?: string;
  source_provider?: string;
  runtime_generation?: number | string;
  connection_epoch?: string;
  connection_attempt_id?: string;
}

export interface IWhatsappRuntimeFenceActivationResponseProto {
  activated?: boolean;
  already_active?: boolean;
  connection_sequence?: number | string;
}

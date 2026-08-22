const OFFICIAL_WHATSAPP_WORKER_TYPE_ID = '019a930d-c6f6-766d-9c84-55fe10d25e2c';

export type OfficialWorkerLike = {
  type_id?: string | null;
  is_official?: boolean | null;
};

export function isOfficialChatWorker(
  worker: OfficialWorkerLike | null | undefined
): boolean {
  if (!worker) return false;
  return (
    worker.is_official === true ||
    worker.type_id === OFFICIAL_WHATSAPP_WORKER_TYPE_ID
  );
}

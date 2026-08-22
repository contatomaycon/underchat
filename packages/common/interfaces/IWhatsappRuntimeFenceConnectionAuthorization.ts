/**
 * Durable database authorization bound to one provider connection scope.
 * A pairing grant always carries an attempt id; legacy owned epochs may not.
 */
export interface IWhatsappRuntimeFenceConnectionAuthorization {
  connection_epoch: string;
  connection_attempt_id?: string;
}

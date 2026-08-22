export interface IViewWorkerServer {
  server_id: string;
  account_id: string;
  key: string;
  server_status_id: string;
  web_domain: string;
  web_port: number;
  web_protocol: string;
}

/**
 * Authoritative lifecycle routing data. Unlike {@link IViewWorkerServer}, this
 * contract deliberately does not depend on an account API key or on a public
 * web endpoint: neither is required to move or recreate an existing runtime.
 */
export interface IViewWorkerLifecycleServer {
  server_id: string;
  account_id: string;
  server_status_id: string;
}

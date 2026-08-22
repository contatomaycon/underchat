export interface IPublicApiTokenData {
  token_id: string;
  token_hash: string;
  account_id: string;
  actor_user_id: string;
  executor_user_id: string | null;
}

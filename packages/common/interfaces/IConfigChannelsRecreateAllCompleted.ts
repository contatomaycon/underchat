export interface IConfigChannelsRecreateAllCompleted {
  type: 'recreate_all_completed';
  account_id: string;
  success: number;
  errors: number;
}

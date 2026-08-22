import { TFunction } from 'i18next';

export type UserChannelScope = readonly {
  id: string;
  name: string;
}[];

export function assertUserChannelAccess(
  t: TFunction<'translation', undefined>,
  workerId: string,
  userChannels: UserChannelScope = []
): void {
  if (
    userChannels.length > 0 &&
    !userChannels.some((channel) => channel.id === workerId)
  ) {
    throw new Error(t('chat_access_denied'));
  }
}

import { createNavigationContainerRef } from '@react-navigation/native';
import type { ListChatsResult } from '../types/chat';
import type { RootTabParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

export function navigateToChatRoom(chat: ListChatsResult): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }

  navigationRef.navigate('InChat', {
    screen: 'ChatRoom',
    params: { chat },
  });

  return true;
}

import {
  LIST_ALL_CHATS_IN_SECTOR_PERMISSIONS,
  VIEW_CHATBOT_TAB_PERMISSIONS,
  canUseUserAndSectorFilters as canUseUserAndSectorFiltersByAuthorization,
  canViewChatbotTab as canViewChatbotTabByAuthorization,
} from './chatAuthorization';

export const PERMISSIONS_USER_SECTOR_FILTERS = [
  ...LIST_ALL_CHATS_IN_SECTOR_PERMISSIONS,
  'list_all_chats_without_sector_limit',
] as const;
export const PERMISSIONS_VIEW_CHATBOT_TAB = VIEW_CHATBOT_TAB_PERMISSIONS;

export function canUseUserAndSectorFilters(permissions: string[]): boolean {
  return canUseUserAndSectorFiltersByAuthorization(permissions);
}

export function canViewChatbotTab(permissions: string[]): boolean {
  return canViewChatbotTabByAuthorization(permissions);
}

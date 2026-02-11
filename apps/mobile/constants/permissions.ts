export const PERMISSIONS_USER_SECTOR_FILTERS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'list_all_chats_in_sector',
  'list_all_chats_without_sector_limit',
] as const;

export const PERMISSIONS_VIEW_CHATBOT_TAB = [
  'full_access',
  'full_access_group',
  'chat_group',
  'view_chatbot_messages',
] as const;

export function canUseUserAndSectorFilters(permissions: string[]): boolean {
  for (let i = 0; i < PERMISSIONS_USER_SECTOR_FILTERS.length; i++) {
    if (permissions.includes(PERMISSIONS_USER_SECTOR_FILTERS[i])) return true;
  }
  return false;
}

export function canViewChatbotTab(permissions: string[]): boolean {
  for (let i = 0; i < PERMISSIONS_VIEW_CHATBOT_TAB.length; i++) {
    if (permissions.includes(PERMISSIONS_VIEW_CHATBOT_TAB[i])) return true;
  }
  return false;
}

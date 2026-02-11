export const PERMISSIONS_USER_SECTOR_FILTERS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'list_all_chats_in_sector',
  'list_all_chats_without_sector_limit',
] as const;

export function canUseUserAndSectorFilters(permissions: string[]): boolean {
  for (let i = 0; i < PERMISSIONS_USER_SECTOR_FILTERS.length; i++) {
    if (permissions.includes(PERMISSIONS_USER_SECTOR_FILTERS[i])) return true;
  }
  return false;
}

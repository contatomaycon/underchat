import type {
  HorizontalNavItems,
  NavGroup,
  NavLink,
  VerticalNavItems,
} from '@layouts/types';

type NavItemWithBadge = NavLink | NavGroup;
type NavItem = VerticalNavItems[number] | HorizontalNavItems[number];

interface UnreadBadgeCounts {
  chat: number;
  internalChat: number;
}

const UNREAD_BADGE_CLASS = 'nav-item-badge--unread';

export const formatUnreadBadgeContent = (count: number): string | null => {
  if (!Number.isFinite(count)) {
    return null;
  }

  const normalizedCount = Math.trunc(count);
  if (normalizedCount <= 0) {
    return null;
  }

  return normalizedCount > 99 ? '99+' : String(normalizedCount);
};

const isNavItemWithBadge = (item: NavItem): item is NavItemWithBadge =>
  'title' in item;

const isNavGroup = (item: NavItemWithBadge): item is NavGroup =>
  'children' in item;

const withUnreadBadge = (
  item: NavItemWithBadge,
  badgeContent: string | null
): NavItemWithBadge => {
  if (!badgeContent) {
    return {
      ...item,
      badgeContent: null,
      badgeClass: null,
    };
  }

  return {
    ...item,
    badgeContent,
    badgeClass: item.badgeClass
      ? `${item.badgeClass} ${UNREAD_BADGE_CLASS}`
      : UNREAD_BADGE_CLASS,
  };
};

const decorateNavItem = (item: NavItem, counts: UnreadBadgeCounts): NavItem => {
  if (!isNavItemWithBadge(item)) {
    return item;
  }

  const clonedItem: NavItemWithBadge = isNavGroup(item)
    ? {
        ...item,
        children: item.children.map((child) =>
          decorateNavItem(child, counts)
        ) as NavGroup['children'],
      }
    : { ...item };

  if (clonedItem.title === 'chat') {
    return withUnreadBadge(clonedItem, formatUnreadBadgeContent(counts.chat));
  }

  if (clonedItem.title === 'internal_chat_title') {
    return withUnreadBadge(
      clonedItem,
      formatUnreadBadgeContent(counts.internalChat)
    );
  }

  return clonedItem;
};

export const decorateNavItemsWithUnreadBadges = <
  T extends VerticalNavItems | HorizontalNavItems,
>(
  items: T,
  counts: UnreadBadgeCounts
): T => items.map((item) => decorateNavItem(item, counts)) as T;

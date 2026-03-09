import {
  CommonActions,
  createNavigationContainerRef,
} from '@react-navigation/native';
import type { ListChatsResult } from '../types/chat';
import type { ChatStackParamList, ChatTab, RootTabParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

const ROOT_TAB_ROUTES: Array<keyof RootTabParamList> = [
  'InChat',
  'Queue',
  'Chatbot',
  'Closed',
  'New',
];

const CHATBOT_STATUSES = new Set<ListChatsResult['status']>([
  'ura',
  'ura_output',
  'ura_schedule',
  'ura_webhook',
]);

function isRootTabRouteName(value: string): value is keyof RootTabParamList {
  return ROOT_TAB_ROUTES.includes(value as keyof RootTabParamList);
}

function resolvePreferredTabRoute(
  status: ListChatsResult['status']
): keyof RootTabParamList {
  if (status === 'queue') {
    return 'Queue';
  }

  if (status === 'in_chat') {
    return 'InChat';
  }

  if (CHATBOT_STATUSES.has(status)) {
    return 'Chatbot';
  }

  if (status === 'closed') {
    return 'Closed';
  }

  return 'InChat';
}

function resolveChatListTabForRoute(
  routeName: keyof RootTabParamList
): ChatTab {
  if (routeName === 'Queue') return 'queue';
  if (routeName === 'Chatbot') return 'chatbot';
  if (routeName === 'Closed') return 'closed';
  return 'in_chat';
}

function resolveTargetTabRoute(
  preferredRoute: keyof RootTabParamList,
  availableRoutes: Array<keyof RootTabParamList>
): keyof RootTabParamList | null {
  if (availableRoutes.includes(preferredRoute)) {
    return preferredRoute;
  }

  const fallbacks: Array<keyof RootTabParamList> = [
    'InChat',
    'Queue',
    'Chatbot',
    'Closed',
  ];

  for (const fallback of fallbacks) {
    if (availableRoutes.includes(fallback)) {
      return fallback;
    }
  }

  return availableRoutes[0] ?? null;
}

export function navigateToChatRoom(chat: ListChatsResult): boolean {
  if (!navigationRef.isReady()) {
    return false;
  }

  const rootState = navigationRef.getRootState();
  if (!rootState || rootState.routes.length === 0) {
    return false;
  }

  const availableRoutes = rootState.routes
    .map((route) => route.name)
    .filter(isRootTabRouteName);

  const preferredRoute = resolvePreferredTabRoute(chat.status);
  const targetRouteName = resolveTargetTabRoute(
    preferredRoute,
    availableRoutes
  );
  if (!targetRouteName) {
    return false;
  }

  const targetRouteIndex = rootState.routes.findIndex(
    (route) => route.name === targetRouteName
  );

  if (targetRouteIndex < 0) {
    return false;
  }

  const chatListTab = resolveChatListTabForRoute(targetRouteName);
  const targetRoute = rootState.routes[targetRouteIndex];
  const chatListParams: ChatStackParamList['ChatList'] = { tab: chatListTab };
  const chatRoomParams: ChatStackParamList['ChatRoom'] = { chat };

  const nextRoutes = rootState.routes.map((route, index) => {
    if (index !== targetRouteIndex) {
      return route;
    }

    const currentParams =
      (targetRoute.params as Record<string, unknown> | undefined) ?? {};

    return {
      ...targetRoute,
      params: {
        ...currentParams,
        tab: chatListTab,
      },
      state: {
        index: 1,
        routes: [
          { name: 'ChatList', params: chatListParams },
          { name: 'ChatRoom', params: chatRoomParams },
        ],
      },
    };
  });

  try {
    navigationRef.dispatch(
      CommonActions.reset({
        index: targetRouteIndex,
        routes: nextRoutes as any,
      })
    );

    return true;
  } catch {
    return false;
  }
}

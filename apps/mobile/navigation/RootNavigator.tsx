import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { ChatStackNavigator } from './ChatStack';
import { InternalChatStackNavigator } from './InternalChatStack';
import type { ChatTab, RootTabParamList } from './types';
import { colors } from '../theme/colors';
import { useChatFilter } from '../context/ChatFilterContext';
import { useInternalChat } from '../context/InternalChatContext';
import { formatBadgeCount } from '../utils/countFormat';

const Tab = createBottomTabNavigator<RootTabParamList>();
const INTERNAL_CHAT_ACCENT = '#E35D65';
const INTERNAL_CHAT_ACCENT_DARK = '#C94A52';

export function RootNavigator() {
  const {
    hasAppliedAdvancedFilters,
    canViewChatbotTab,
    canViewChatTabs,
    canViewInternalChatTab,
    chatCounts,
  } = useChatFilter();
  const { totalUnread } = useInternalChat();

  const inChatBadge = formatBadgeCount(chatCounts.in_chat, { hideZero: true });
  const queueBadge = formatBadgeCount(chatCounts.queue, { hideZero: true });
  const internalChatBadge = formatBadgeCount(totalUnread, { hideZero: true });
  const chatbotBadgeTotal = chatCounts.chatbot + chatCounts.schedule;
  const chatbotBadge = formatBadgeCount(chatbotBadgeTotal, {
    hideZero: true,
  });
  const closedBadge = formatBadgeCount(chatCounts.closed, { hideZero: true });

  const buildTabListeners = (
    routeName: keyof RootTabParamList,
    tab: ChatTab,
    entry: 'chat_list' | 'contacts' = 'chat_list'
  ) => {
    return ({ navigation }: { navigation: any }) => ({
      tabPress: (event: { preventDefault: () => void }) => {
        event.preventDefault();

        if (entry === 'contacts') {
          navigation.navigate(routeName, {
            screen: 'Contacts',
          });
          return;
        }

        navigation.navigate(routeName, {
          screen: 'ChatList',
          params: { tab },
        });
      },
    });
  };

  return (
    <Tab.Navigator
      initialRouteName={canViewChatTabs ? 'InChat' : 'InternalChat'}
      screenOptions={{
        headerShown: false,
        popToTopOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.grey600,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.grey200,
        },
        tabBarBadgeStyle: {
          minWidth: 20,
          height: 18,
          borderRadius: 999,
          paddingHorizontal: 5,
          paddingVertical: 0,
          textAlign: 'center',
          textAlignVertical: 'center',
          includeFontPadding: false,
          fontSize: 10,
          lineHeight: 12,
        },
      }}
    >
      {canViewChatTabs ? (
        <Tab.Screen
          name="InChat"
          component={ChatStackNavigator}
          initialParams={{ tab: 'in_chat' }}
          listeners={buildTabListeners('InChat', 'in_chat')}
          options={{
            tabBarLabel: 'Em atendimento',
            tabBarBadge: inChatBadge,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubble-ellipses" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canViewChatTabs ? (
        <Tab.Screen
          name="Queue"
          component={ChatStackNavigator}
          initialParams={{ tab: 'queue' }}
          listeners={buildTabListeners('Queue', 'queue')}
          options={{
            tabBarLabel: 'Fila',
            tabBarBadge: queueBadge,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubble" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canViewInternalChatTab ? (
        <Tab.Screen
          name="InternalChat"
          component={InternalChatStackNavigator}
          options={{
            tabBarLabel: 'Interno',
            tabBarBadge: internalChatBadge,
            tabBarAccessibilityLabel: 'Chat Interno',
            tabBarIcon: ({ focused }) => (
              <View
                style={[
                  styles.internalTabIcon,
                  focused && styles.internalTabIconFocused,
                ]}
              >
                <Ionicons name="people" size={28} color={colors.onError} />
              </View>
            ),
            tabBarLabelStyle: styles.internalTabLabel,
          }}
        />
      ) : null}
      {canViewChatbotTab ? (
        <Tab.Screen
          name="Chatbot"
          component={ChatStackNavigator}
          initialParams={{ tab: 'chatbot' }}
          listeners={buildTabListeners('Chatbot', 'chatbot')}
          options={{
            tabBarLabel: 'Chatbot',
            tabBarBadge: chatbotBadge,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubbles-outline" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canViewChatTabs && hasAppliedAdvancedFilters ? (
        <Tab.Screen
          name="Closed"
          component={ChatStackNavigator}
          initialParams={{ tab: 'closed' }}
          listeners={buildTabListeners('Closed', 'closed')}
          options={{
            tabBarLabel: 'Fechado',
            tabBarBadge: closedBadge,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="lock-closed-outline" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canViewChatTabs ? (
        <Tab.Screen
          name="New"
          component={ChatStackNavigator}
          initialParams={{ tab: 'in_chat', entry: 'contacts' }}
          listeners={buildTabListeners('New', 'in_chat', 'contacts')}
          options={{
            tabBarLabel: 'Novo',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add" size={size} color={color} />
            ),
          }}
        />
      ) : null}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  internalTabIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginTop: -18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INTERNAL_CHAT_ACCENT,
    shadowColor: INTERNAL_CHAT_ACCENT_DARK,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 4,
  },
  internalTabIconFocused: {
    transform: [{ scale: 1.08 }],
  },
  internalTabLabel: {
    color: INTERNAL_CHAT_ACCENT_DARK,
  },
});

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ChatStackNavigator } from './ChatStack';
import type { ChatTab } from './types';
import { colors } from '../theme/colors';
import { useChatFilter } from '../context/ChatFilterContext';

type TabParamList = {
  New: { tab: ChatTab; entry: 'contacts' };
  InChat: { tab: ChatTab };
  Queue: { tab: ChatTab };
  Closed: { tab: ChatTab };
  Chatbot: { tab: ChatTab };
};

const Tab = createBottomTabNavigator<TabParamList>();

export function RootNavigator() {
  const { hasAppliedAdvancedFilters, canViewChatbotTab } = useChatFilter();

  return (
    <Tab.Navigator
      initialRouteName="InChat"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.grey600,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.grey200,
        },
      }}
    >
      <Tab.Screen
        name="InChat"
        component={ChatStackNavigator}
        initialParams={{ tab: 'in_chat' }}
        options={{
          tabBarLabel: 'Em atendimento',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Queue"
        component={ChatStackNavigator}
        initialParams={{ tab: 'queue' }}
        options={{
          tabBarLabel: 'Fila',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble" size={size} color={color} />
          ),
        }}
      />
      {canViewChatbotTab ? (
        <Tab.Screen
          name="Chatbot"
          component={ChatStackNavigator}
          initialParams={{ tab: 'chatbot' }}
          options={{
            tabBarLabel: 'Chatbot',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubbles-outline" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {hasAppliedAdvancedFilters ? (
        <Tab.Screen
          name="Closed"
          component={ChatStackNavigator}
          initialParams={{ tab: 'closed' }}
          options={{
            tabBarLabel: 'Fechado',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="lock-closed-outline" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      <Tab.Screen
        name="New"
        component={ChatStackNavigator}
        initialParams={{ tab: 'in_chat', entry: 'contacts' }}
        options={{
          tabBarLabel: 'Novo',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

import { useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';
import { ContactListScreen } from '../screens/ContactListScreen';
import type { ChatStackParamList, ChatTab } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStackNavigator() {
  const route = useRoute();
  const params = route.params as {
    tab?: ChatTab;
    entry?: 'chat_list' | 'contacts';
  };
  const tab = params?.tab ?? 'in_chat';
  const initialRouteName =
    params?.entry === 'contacts' ? 'Contacts' : 'ChatList';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.onSurface,
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        initialParams={{ tab }}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={{ title: '' }}
      />
      <Stack.Screen
        name="Contacts"
        component={ContactListScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

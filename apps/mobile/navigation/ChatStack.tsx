import { useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';
import type { ChatStackParamList, ChatTab } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStackNavigator() {
  const route = useRoute();
  const tab = (route.params as { tab?: ChatTab })?.tab ?? 'in_chat';

  return (
    <Stack.Navigator
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
    </Stack.Navigator>
  );
}

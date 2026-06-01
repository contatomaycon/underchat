import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { InternalChatListScreen } from '../screens/InternalChatListScreen';
import { InternalChatRoomScreen } from '../screens/InternalChatRoomScreen';
import type { InternalChatStackParamList } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<InternalChatStackParamList>();

export function InternalChatStackNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="InternalChatList"
      screenOptions={{
        headerShown: false,
        headerTintColor: colors.onSurface,
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="InternalChatList"
        component={InternalChatListScreen}
      />
      <Stack.Screen
        name="InternalChatRoom"
        component={InternalChatRoomScreen}
      />
    </Stack.Navigator>
  );
}

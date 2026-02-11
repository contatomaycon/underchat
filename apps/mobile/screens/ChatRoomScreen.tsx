import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import type { ListMessageResult } from '../types/chat';
import { listMessages, createMessage } from '../api/chatApi';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatRoom'>;

function MessageBubble({
  msg,
  fromMe,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
}) {
  const text = msg.message ?? msg.image?.caption ?? msg.video?.caption ?? '';
  return (
    <View
      style={[
        styles.bubbleWrap,
        fromMe ? styles.bubbleWrapRight : styles.bubbleWrapLeft,
      ]}
    >
      <View
        style={[styles.bubble, fromMe ? styles.bubbleRight : styles.bubbleLeft]}
      >
        {text ? (
          <Text
            style={[
              styles.bubbleText,
              fromMe ? styles.bubbleTextRight : styles.bubbleTextLeft,
            ]}
          >
            {text}
          </Text>
        ) : null}
        <Text style={styles.bubbleTime}>
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

export function ChatRoomScreen({ route, navigation }: Props) {
  const { chat } = route.params;
  const [messages, setMessages] = useState<ListMessageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const res = await listMessages(chat.chat_id, 1, 50);
    setLoading(false);
    if (res?.results) setMessages(res.results.reverse());
  }, [chat.chat_id]);

  useEffect(() => {
    navigation.setOptions({
      title: chat.name ?? chat.contact?.name ?? chat.phone ?? 'Chat',
    });
  }, [navigation, chat.name, chat.contact?.name, chat.phone]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');
    const newMsg = await createMessage(chat.chat_id, 'text', text);
    setSending(false);
    if (newMsg) {
      setMessages((prev) => [...prev, newMsg]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.message_chat_id}
          renderItem={({ item }) => (
            <MessageBubble msg={item} fromMe={item.from_me} />
          )}
          contentContainerStyle={styles.listContent}
          inverted={false}
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={pt.type_message}
          placeholderTextColor={colors.grey500}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={65535}
          editable={!sending}
        />
        <Pressable
          style={[
            styles.sendBtn,
            (!input.trim() || sending) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Ionicons name="send" size={22} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 12,
    paddingBottom: 8,
  },
  bubbleWrap: {
    marginVertical: 2,
  },
  bubbleWrapLeft: {
    alignItems: 'flex-start',
  },
  bubbleWrapRight: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  bubbleLeft: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleRight: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
  },
  bubbleTextLeft: {
    color: colors.onSurface,
  },
  bubbleTextRight: {
    color: colors.onPrimary,
  },
  bubbleTime: {
    fontSize: 11,
    color: colors.grey600,
    marginTop: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.inputBg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});

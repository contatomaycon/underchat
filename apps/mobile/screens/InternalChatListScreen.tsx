import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppAvatar } from '../components/AppAvatar';
import { useInternalChat } from '../context/InternalChatContext';
import { getPermissions } from '../storage/authStorage';
import {
  canCreateInternalChatGroup,
} from '../constants/chatAuthorization';
import type { InternalChatStackParamList } from '../navigation/types';
import type {
  InternalChatConversation,
  InternalChatTab,
  InternalChatUser,
} from '../types/internalChat';
import {
  INTERNAL_CHAT_CONVERSATION_TYPE,
  INTERNAL_CHAT_TAB,
} from '../types/internalChat';
import { colors } from '../theme/colors';
import { pt } from '../locales/pt';
import {
  dismissKeyboard,
  dismissKeyboardAnd,
  keyboardAvoidingBehavior,
} from '../utils/keyboard';
import { resolveInternalChatTextTag } from '../utils/internalChatText';

type Navigation = NativeStackNavigationProp<InternalChatStackParamList>;

const OPTIONS: Array<{
  tab: InternalChatTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { tab: INTERNAL_CHAT_TAB.users, label: 'Nova conversa', icon: 'add' },
  { tab: INTERNAL_CHAT_TAB.all, label: 'Todos', icon: 'list' },
  { tab: INTERNAL_CHAT_TAB.direct, label: 'Diretas', icon: 'chatbubble-outline' },
  { tab: INTERNAL_CHAT_TAB.group, label: 'Grupos', icon: 'people-outline' },
];

function formatConversationDate(date: string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  if (parsed.toDateString() === now.toDateString()) {
    return parsed.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (parsed.toDateString() === yesterday.toDateString()) {
    return 'Ontem';
  }
  return parsed.toLocaleDateString('pt-BR');
}

function resolveConversationTitle(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string {
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return conversation.name?.trim() || 'Grupo';
  }
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.name || conversation.name || 'Conversa';
}

function resolveConversationPhoto(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string | null {
  if (conversation.photo) return conversation.photo;
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) return null;
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.photo ?? null;
}

function resolveAssetName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName && asset.fileName.trim()) return asset.fileName;
  const extension = asset.mimeType?.split('/')[1] || 'jpg';
  return `grupo-${Date.now()}.${extension}`;
}

export function InternalChatListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const {
    currentUserId,
    state,
    loadingConversations,
    loadingUsers,
    totalUnread,
    loadConversations,
    loadUsers,
    openConversation,
    openDirect,
    createGroup,
  } = useInternalChat();

  const [activeTab, setActiveTab] = useState<InternalChatTab>(
    INTERNAL_CHAT_TAB.all
  );
  const [search, setSearch] = useState('');
  const [canCreateGroup, setCanCreateGroup] = useState(false);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupPhoto, setGroupPhoto] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [openingConversationId, setOpeningConversationId] = useState<
    string | null
  >(null);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);

  const openingChat = !!openingConversationId || !!openingUserId;

  useEffect(() => {
    let cancelled = false;
    void getPermissions().then((permissions) => {
      if (!cancelled) {
        setCanCreateGroup(canCreateInternalChatGroup(permissions));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === INTERNAL_CHAT_TAB.users) {
        void loadUsers({ search, page: 1, append: false });
        return;
      }
      void loadConversations({
        tab: activeTab,
        search,
        page: 1,
        append: false,
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [activeTab, loadConversations, loadUsers, search]);

  const conversations = state.conversations;
  const users = state.users;

  const optionTitle = useMemo(() => {
    return OPTIONS.find((item) => item.tab === activeTab)?.label ?? 'Todos';
  }, [activeTab]);

  const handleOpenConversation = useCallback(
    async (conversation: InternalChatConversation) => {
      if (openingChat) return;
      setOpeningConversationId(conversation.conversation_id);
      try {
        const opened = await openConversation(conversation.conversation_id);
        if (opened) {
          navigation.navigate('InternalChatRoom', { conversation: opened });
          return;
        }
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } catch {
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } finally {
        setOpeningConversationId(null);
      }
    },
    [navigation, openConversation, openingChat]
  );

  const handleOpenDirect = useCallback(
    async (user: InternalChatUser) => {
      if (openingChat) return;
      setOpeningUserId(user.user_id);
      try {
        const conversation = await openDirect(user.user_id);
        if (conversation) {
          navigation.navigate('InternalChatRoom', { conversation });
          return;
        }
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } catch {
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } finally {
        setOpeningUserId(null);
      }
    },
    [navigation, openDirect, openingChat]
  );

  const loadMoreConversations = useCallback(() => {
    if (loadingConversations) return;
    const paging = state.conversationsPaging;
    if (paging.current_page >= paging.total_pages) return;
    void loadConversations({
      tab: activeTab,
      search,
      page: paging.current_page + 1,
      append: true,
    });
  }, [
    activeTab,
    loadConversations,
    loadingConversations,
    search,
    state.conversationsPaging,
  ]);

  const loadMoreUsers = useCallback(() => {
    if (loadingUsers) return;
    const paging = state.usersPaging;
    if (paging.current_page >= paging.total_pages) return;
    void loadUsers({
      search,
      page: paging.current_page + 1,
      append: true,
    });
  }, [loadUsers, loadingUsers, search, state.usersPaging]);

  const toggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId]
    );
  }, []);

  const pickGroupPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    setGroupPhoto({
      uri: asset.uri,
      name: resolveAssetName(asset),
      mimeType: asset.mimeType || 'image/jpeg',
    });
  }, []);

  const closeGroupModal = useCallback(() => {
    if (creatingGroup) return;
    setGroupModalVisible(false);
    setGroupName('');
    setSelectedMemberIds([]);
    setGroupPhoto(null);
  }, [creatingGroup]);

  const submitCreateGroup = useCallback(async () => {
    const normalizedName = groupName.trim();
    if (!normalizedName) {
      Alert.alert(pt.warning_title, 'Informe o nome do grupo.');
      return;
    }
    if (selectedMemberIds.length === 0) {
      Alert.alert(pt.warning_title, 'Selecione pelo menos um membro.');
      return;
    }
    setCreatingGroup(true);
    try {
      const conversation = await createGroup({
        name: normalizedName,
        member_user_ids: selectedMemberIds,
        photoUri: groupPhoto?.uri ?? null,
        photoName: groupPhoto?.name ?? null,
        photoMimeType: groupPhoto?.mimeType ?? null,
      });
      if (!conversation) {
        Alert.alert(pt.error_title, 'Não foi possível criar o grupo.');
        return;
      }
      closeGroupModal();
      navigation.navigate('InternalChatRoom', { conversation });
    } finally {
      setCreatingGroup(false);
    }
  }, [
    closeGroupModal,
    createGroup,
    groupName,
    groupPhoto,
    navigation,
    selectedMemberIds,
  ]);

  const renderConversation: ListRenderItem<InternalChatConversation> =
    useCallback(
      ({ item }) => {
        const title = resolveConversationTitle(item, currentUserId);
        const photo = resolveConversationPhoto(item, currentUserId);
        const opening = openingConversationId === item.conversation_id;
        const preview =
          resolveInternalChatTextTag(item.last_message_preview) ||
          (item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group
            ? 'Atualização do grupo'
            : 'Conversa direta');

        return (
          <Pressable
            style={[styles.row, opening && styles.rowOpening]}
            onPress={() => void handleOpenConversation(item)}
            disabled={openingChat}
          >
            <AppAvatar
              uri={photo}
              size={48}
              iconName={
                item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group
                  ? 'people'
                  : 'person'
              }
            />
            <View style={styles.rowContent}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.rowDate}>
                  {formatConversationDate(item.last_message_at)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewText} numberOfLines={1}>
                  {preview}
                </Text>
                {item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group ? (
                  <View style={styles.groupBadge}>
                    <Ionicons
                      name="people-outline"
                      size={11}
                      color={colors.primary}
                    />
                    <Text style={styles.groupBadgeText}>Grupo</Text>
                  </View>
                ) : null}
              </View>
            </View>
            {opening ? (
              <ActivityIndicator color={colors.primary} />
            ) : item.unread_count > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      },
      [currentUserId, handleOpenConversation, openingChat, openingConversationId]
    );

  const renderUser: ListRenderItem<InternalChatUser> = useCallback(
    ({ item }) => {
      const opening = openingUserId === item.user_id;

      return (
        <Pressable
          style={[styles.row, opening && styles.rowOpening]}
          onPress={() => void handleOpenDirect(item)}
          disabled={openingChat}
        >
          <AppAvatar uri={item.photo} size={48} />
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {item.email || item.sector || item.position ? (
              <Text style={styles.previewText} numberOfLines={1}>
                {[item.email, item.sector, item.position]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            ) : null}
          </View>
          {opening ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons
              name="chatbubble-outline"
              size={22}
              color={colors.primary}
            />
          )}
        </Pressable>
      );
    },
    [handleOpenDirect, openingChat, openingUserId]
  );

  const listEmpty = (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Ionicons
          name={
            activeTab === INTERNAL_CHAT_TAB.users
              ? 'person-add-outline'
              : 'chatbubbles-outline'
          }
          size={28}
          color={colors.primary}
        />
      </View>
      <Text style={styles.emptyText}>
        {activeTab === INTERNAL_CHAT_TAB.users
          ? 'Nenhum usuário encontrado'
          : activeTab === INTERNAL_CHAT_TAB.direct
            ? 'Nenhuma conversa direta'
            : activeTab === INTERNAL_CHAT_TAB.group
              ? 'Nenhum grupo encontrado'
              : 'Nenhuma conversa encontrada'}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={keyboardAvoidingBehavior}
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerTitleIcon}>
            <Ionicons name="people" size={20} color={colors.primary} />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Chat Interno</Text>
            <Text style={styles.headerSubtitle}>
              {totalUnread > 0
                ? `${totalUnread} não lida${totalUnread > 1 ? 's' : ''}`
                : optionTitle}
            </Text>
          </View>
          {canCreateGroup ? (
            <Pressable
              style={styles.headerAction}
              onPress={() => {
                setGroupModalVisible(true);
                void loadUsers({ page: 1, append: false });
              }}
              accessibilityLabel="Criar grupo"
            >
              <Ionicons
                name="person-add-outline"
                size={20}
                color={colors.primary}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.grey500} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={
              activeTab === INTERNAL_CHAT_TAB.users
                ? 'Pesquisar usuários'
                : 'Pesquisar conversas'
            }
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
          />
          {search.trim() ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.optionsGrid}>
          {OPTIONS.map((option) => {
            const active = option.tab === activeTab;
            return (
              <Pressable
                key={option.tab}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => setActiveTab(option.tab)}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={active ? colors.onPrimary : colors.primary}
                />
                <Text
                  style={[
                    styles.optionText,
                    active && styles.optionTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {activeTab === INTERNAL_CHAT_TAB.users ? (
        <FlatList
          data={users}
          keyExtractor={(item) => item.user_id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreUsers}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={!loadingUsers ? listEmpty : null}
          ListFooterComponent={
            loadingUsers ? <ActivityIndicator style={styles.listLoader} /> : null
          }
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.conversation_id}
          renderItem={renderConversation}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreConversations}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={!loadingConversations ? listEmpty : null}
          ListFooterComponent={
            loadingConversations ? (
              <ActivityIndicator style={styles.listLoader} />
            ) : null
          }
        />
      )}

      <Modal
        visible={openingChat}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.openingOverlay}>
          <View style={styles.openingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.openingTitle}>Abrindo conversa...</Text>
            <Text style={styles.openingText}>
              Carregando mensagens do chat interno.
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={groupModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeGroupModal}
      >
        <View style={[styles.modalOverlay, { paddingBottom: insets.bottom }]}>
          <Pressable style={styles.backdrop} onPress={dismissKeyboard} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Novo grupo</Text>
              <Pressable onPress={closeGroupModal} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.grey700} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Pressable style={styles.photoPicker} onPress={pickGroupPhoto}>
                <AppAvatar
                  uri={groupPhoto?.uri ?? null}
                  size={58}
                  iconName="people"
                />
                <Text style={styles.photoPickerText}>
                  {groupPhoto ? 'Alterar foto' : 'Selecionar foto'}
                </Text>
              </Pressable>
              <Text style={styles.inputLabel}>Nome do grupo</Text>
              <TextInput
                style={styles.input}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Digite o nome"
                placeholderTextColor={colors.grey500}
              />
              <View style={styles.membersHeader}>
                <Text style={styles.inputLabel}>Membros</Text>
                <Text style={styles.membersCount}>
                  {selectedMemberIds.length} selecionado
                  {selectedMemberIds.length === 1 ? '' : 's'}
                </Text>
              </View>
              {users.map((user) => {
                const selected = selectedMemberIds.includes(user.user_id);
                return (
                  <Pressable
                    key={user.user_id}
                    style={styles.memberRow}
                    onPress={() => toggleMember(user.user_id)}
                  >
                    <AppAvatar uri={user.photo} size={40} />
                    <Text style={styles.memberName} numberOfLines={1}>
                      {user.name}
                    </Text>
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={selected ? colors.primary : colors.grey500}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={closeGroupModal}>
                <Text style={styles.cancelText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  creatingGroup && styles.primaryBtnDisabled,
                ]}
                onPress={dismissKeyboardAnd(submitCreateGroup)}
                disabled={creatingGroup}
              >
                {creatingGroup ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryText}>Criar grupo</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  headerTitleIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF2FF',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onSurface,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.grey600,
    marginTop: 2,
  },
  headerAction: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF2FF',
    borderWidth: 1,
    borderColor: '#D6E6FF',
  },
  searchRow: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.inputBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    paddingVertical: 8,
  },
  optionsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 3,
    backgroundColor: '#EEF5FF',
  },
  optionBtnActive: {
    backgroundColor: colors.primary,
  },
  optionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  optionTextActive: {
    color: colors.onPrimary,
  },
  listContent: {
    paddingVertical: 8,
    backgroundColor: colors.surface,
    flexGrow: 1,
  },
  row: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
    backgroundColor: colors.surface,
  },
  rowOpening: {
    opacity: 0.72,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '800',
  },
  rowDate: {
    color: colors.grey500,
    fontSize: 12,
  },
  previewRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewText: {
    flex: 1,
    color: colors.grey600,
    fontSize: 13,
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.tagBg,
  },
  groupBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  unreadText: {
    color: colors.onError,
    fontSize: 11,
    fontWeight: '800',
  },
  listLoader: {
    paddingVertical: 18,
  },
  emptyWrap: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: {
    color: colors.grey600,
    fontSize: 14,
    textAlign: 'center',
  },
  openingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  openingCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  openingTitle: {
    marginTop: 14,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: '800',
  },
  openingText: {
    marginTop: 6,
    color: colors.grey600,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 14,
  },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  modalTitle: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: '800',
  },
  photoPicker: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoPickerText: {
    color: colors.primary,
    fontWeight: '800',
  },
  inputLabel: {
    paddingHorizontal: 18,
    color: colors.grey700,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    marginHorizontal: 18,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    color: colors.onSurface,
    marginBottom: 14,
  },
  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  membersCount: {
    paddingHorizontal: 18,
    color: colors.grey500,
    fontSize: 12,
  },
  memberRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  memberName: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  cancelText: {
    color: colors.grey700,
    fontWeight: '800',
  },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  primaryText: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
});

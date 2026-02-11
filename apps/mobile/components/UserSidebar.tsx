import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { listChatContacts, type ListChatContactResult } from '../api/chatApi';
import { clearAuth } from '../storage/authStorage';
import { emitAuthUnauthorized } from '../utils/authEvents';
import { resolveImageUri } from '../utils/imageUri';

interface UserSidebarProps {
  visible: boolean;
  onClose: () => void;
  onLogout?: () => void;
}

function ContactRow({
  item,
  onPress,
}: {
  item: ListChatContactResult;
  onPress: () => void;
}) {
  const displayName =
    item.name || item.last_name
      ? [item.name, item.last_name].filter(Boolean).join(' ')
      : item.phone_partial || item.contact_id;
  const phoneLabel = item.phone_partial ?? '';

  return (
    <Pressable style={styles.contactRow} onPress={onPress}>
      <View style={styles.contactAvatar}>
        {(() => {
          const uri = resolveImageUri(item.photo);
          return uri ? (
            <Image
              source={{ uri }}
              style={styles.contactAvatarImage}
            />
          ) : (
            <Ionicons name="person" size={24} color={colors.grey500} />
          );
        })()}
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName} numberOfLines={1}>
          {displayName}
        </Text>
        {phoneLabel ? (
          <Text style={styles.contactPhone} numberOfLines={1}>
            {phoneLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function UserSidebar({ visible, onClose, onLogout }: UserSidebarProps) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<ListChatContactResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    const res = await listChatContacts(1, 50, search || undefined);
    setContacts(res?.results ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(loadContacts, 300);
    return () => clearTimeout(t);
  }, [visible, loadContacts]);

  const handleLogout = async () => {
    setLogoutLoading(true);
    await clearAuth();
    emitAuthUnauthorized();
    setLogoutLoading(false);
    onClose();
    onLogout?.();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>{pt.contacts}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons
              name="search"
              size={20}
              color={colors.grey500}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder={pt.search_contacts}
              placeholderTextColor={colors.grey500}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={contacts}
              keyExtractor={(item) => item.contact_id}
              renderItem={({ item }) => (
                <ContactRow item={item} onPress={onClose} />
              )}
              style={styles.contactList}
              contentContainerStyle={styles.contactListContent}
              ListEmptyComponent={
                !loading && contacts.length === 0 ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>{pt.no_contacts_found}</Text>
                  </View>
                ) : null
              }
            />
          )}
          <View style={styles.footer}>
            <Pressable
              style={[
                styles.logoutBtn,
                logoutLoading && styles.logoutBtnDisabled,
              ]}
              onPress={handleLogout}
              disabled={logoutLoading}
            >
              {logoutLoading ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="log-out-outline"
                    size={22}
                    color={colors.onPrimary}
                    style={styles.logoutIcon}
                  />
                  <Text style={styles.logoutText}>{pt.logout}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sidebar: {
    width: 320,
    maxWidth: '85%',
    backgroundColor: colors.surface,
    ...(Platform.OS === 'web'
      ? { boxShadow: '-2px 0 8px rgba(0,0,0,0.15)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: -2, height: 0 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 8,
        }),
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 12,
    height: 44,
    backgroundColor: colors.grey100,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  contactList: {
    flex: 1,
  },
  contactListContent: {
    paddingBottom: 16,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.grey200,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  contactAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  contactInfo: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  contactPhone: {
    fontSize: 12,
    color: colors.grey600,
    marginTop: 2,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.grey600,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutBtnDisabled: {
    opacity: 0.7,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onPrimary,
  },
});

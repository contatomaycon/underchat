import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addInAppNotificationListener,
  type InAppNotificationPayload,
} from '../services/inAppNotificationBus';
import { colors } from '../theme/colors';

type DisplayNotification = InAppNotificationPayload & {
  key: string;
};

const AUTO_DISMISS_MS = 4_500;

export function InAppNotificationHost() {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-96)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationRef = useRef<DisplayNotification | null>(null);
  const [notification, setNotification] = useState<DisplayNotification | null>(
    null
  );

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const hideNotification = useCallback(() => {
    clearDismissTimer();
    const hidingKey = notificationRef.current?.key;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -96,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && notificationRef.current?.key === hidingKey) {
        notificationRef.current = null;
        setNotification(null);
      }
    });
  }, [clearDismissTimer, opacity, translateY]);

  const showNotification = useCallback(
    (payload: InAppNotificationPayload) => {
      clearDismissTimer();
      translateY.stopAnimation();
      opacity.stopAnimation();
      const next: DisplayNotification = {
        ...payload,
        key: payload.id ?? `${Date.now()}`,
      };
      notificationRef.current = next;
      setNotification(next);
      translateY.setValue(-96);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 18,
          stiffness: 220,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }),
      ]).start();

      dismissTimerRef.current = setTimeout(() => {
        hideNotification();
      }, AUTO_DISMISS_MS);
    },
    [clearDismissTimer, hideNotification, opacity, translateY]
  );

  useEffect(() => {
    return addInAppNotificationListener(showNotification);
  }, [showNotification]);

  useEffect(() => {
    return () => {
      clearDismissTimer();
    };
  }, [clearDismissTimer]);

  const handlePress = useCallback(() => {
    const current = notificationRef.current;
    hideNotification();
    current?.onPress?.();
  }, [hideNotification]);

  const handleDismissPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      hideNotification();
    },
    [hideNotification]
  );

  if (!notification) {
    return null;
  }

  const iconName =
    (notification.icon as keyof typeof Ionicons.glyphMap | undefined) ??
    'notifications-outline';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          top: Math.max(insets.top, 8) + 8,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable style={styles.card} onPress={handlePress}>
        <View style={styles.iconWrap}>
          <Ionicons name={iconName} size={20} color={colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {notification.body}
          </Text>
        </View>
        <Pressable
          style={styles.closeButton}
          onPress={handleDismissPress}
          hitSlop={10}
        >
          <Ionicons name="close" size={18} color={colors.grey600} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1000,
    elevation: 12,
  },
  card: {
    minHeight: 72,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.grey900,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40, 101, 183, 0.1)',
    marginRight: 10,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  body: {
    color: colors.grey600,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});

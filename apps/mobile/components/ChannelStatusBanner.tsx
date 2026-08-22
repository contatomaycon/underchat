import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChannelStatus } from '../context/ChannelStatusContext';
import { colors } from '../theme/colors';
import { pt } from '../locales/pt';
import type { WhatsappConnectionPublicStatus } from '../../../packages/common/functions/whatsappConnectionStatus';

const STATUS_ERROR = '019a930d-c6f6-766d-9c84-48cb970a9f21';
const STATUS_MISMATCHED = '019a930d-c6f6-766d-9c84-5056ccf66633';

const ERROR_STATUSES = new Set([STATUS_ERROR, STATUS_MISMATCHED]);
const CONNECTION_STATUS_LABELS: Record<WhatsappConnectionPublicStatus, string> =
  {
    connecting: 'conectando',
    qr: pt.channel_awaiting_qr,
    online: pt.channel_online,
    offline: 'offline',
    reconnect_required: 'requer nova conexão',
    error: 'com erro de conexão',
  };

function getBannerSeverity(
  channels: Array<{
    status: { id: string; name: string | null } | null;
    connection_status?: WhatsappConnectionPublicStatus | null;
  }>
): 'error' | 'warning' {
  for (const ch of channels) {
    if (
      ch.connection_status === 'error' ||
      ch.connection_status === 'reconnect_required'
    ) {
      return 'error';
    }
    if (ch.status?.id && ERROR_STATUSES.has(ch.status.id)) return 'error';
  }
  return 'warning';
}

export function ChannelStatusBanner() {
  const { offlineChannels } = useChannelStatus();

  const severity = useMemo(
    () => getBannerSeverity(offlineChannels),
    [offlineChannels]
  );

  const bannerText = useMemo(() => {
    if (offlineChannels.length === 0) return '';
    if (offlineChannels.length === 1) {
      const ch = offlineChannels[0];
      const statusLabel = ch.connection_status
        ? CONNECTION_STATUS_LABELS[ch.connection_status]
        : (ch.status?.name ?? 'offline');
      return `Canal "${ch.name}": ${statusLabel}`;
    }
    return `${offlineChannels.length} canais com problemas`;
  }, [offlineChannels]);

  if (offlineChannels.length === 0) return null;

  const isError = severity === 'error';
  const bgColor = isError ? colors.error : colors.warning;
  const textColor = isError ? colors.onError : colors.onWarning;
  const iconName = isError ? 'alert-circle' : 'warning';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <Ionicons
        name={iconName}
        size={16}
        color={textColor}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>
        {bannerText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  icon: {
    marginRight: 6,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
});

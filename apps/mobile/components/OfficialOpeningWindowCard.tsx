import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import type { OfficialWindow } from '../types/chat';

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;
const CLOCK_REFRESH_MS = 30 * 1000;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

type OfficialOpeningWindowCardProps = {
  window: OfficialWindow | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatTimestamp(value?: string | null): string | null {
  const timestamp = parseTimestamp(value);
  return timestamp === null ? null : DATE_TIME_FORMATTER.format(timestamp);
}

function formatRemaining(expiresAt: number, now: number): string {
  const remainingMinutes = Math.max(
    0,
    Math.ceil((expiresAt - now) / (60 * 1000))
  );
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

export function OfficialOpeningWindowCard({
  window,
  loading,
  error,
  onRetry,
}: OfficialOpeningWindowCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const isPendingProviderOutcome =
    window?.state === 'awaiting_contact_reply' ||
    window?.state === 'send_uncertain';
  const expirationValue = isPendingProviderOutcome
    ? window?.awaiting_contact_reply_expires_at
    : window?.service_window_expires_at;
  const expiresAt = parseTimestamp(expirationValue);

  useEffect(() => {
    if (window?.state !== 'open' || expiresAt === null) return;

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), CLOCK_REFRESH_MS);
    return () => clearInterval(interval);
  }, [expiresAt, window?.state]);

  const presentation = useMemo(() => {
    if (!window || window.state === 'closed') {
      const hasNoHistory = !window || window.reason === 'no_customer_message';
      return {
        icon: 'lock-closed-outline' as const,
        eyebrow: pt.official_window_status,
        title: hasNoHistory
          ? pt.official_window_no_history_title
          : pt.official_window_closed_title,
        description: hasNoHistory
          ? pt.official_window_no_history_description
          : pt.official_window_opening_closed_description,
        tone: 'closed' as const,
      };
    }

    if (window.state === 'awaiting_contact_reply') {
      return {
        icon: 'hourglass-outline' as const,
        eyebrow: pt.official_window_status,
        title: pt.official_window_awaiting_title,
        description: pt.official_window_opening_awaiting_description,
        tone: 'awaiting' as const,
      };
    }

    if (window.state === 'send_uncertain') {
      return {
        icon: 'help-circle-outline' as const,
        eyebrow: pt.official_window_status,
        title: pt.official_window_uncertain_title,
        description: pt.official_window_opening_uncertain_description,
        tone: 'uncertain' as const,
      };
    }

    return {
      icon: 'radio-outline' as const,
      eyebrow: pt.official_window_status,
      title: pt.official_window_open_title,
      description: pt.official_window_open_description,
      tone: 'open' as const,
    };
  }, [window]);

  if (loading) {
    return (
      <View
        style={[styles.card, styles.loadingCard]}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <View style={styles.loadingCopy}>
          <View style={[styles.skeleton, styles.skeletonTitle]} />
          <View style={[styles.skeleton, styles.skeletonLine]} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={[styles.card, styles.errorCard]}
        accessibilityLiveRegion="assertive"
      >
        <View style={styles.statusHeader}>
          <View style={[styles.iconWrap, styles.errorIconWrap]}>
            <Ionicons name="cloud-offline-outline" size={19} color="#B42318" />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, styles.errorText]}>
              {pt.official_window_status}
            </Text>
            <Text style={styles.title}>{pt.official_window_error_title}</Text>
          </View>
        </View>
        <Text style={styles.description}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.retryButton}
          onPress={onRetry}
        >
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={styles.retryButtonText}>{pt.try_again}</Text>
        </Pressable>
      </View>
    );
  }

  const startedAt = isPendingProviderOutcome
    ? formatTimestamp(window?.awaiting_contact_reply_since)
    : formatTimestamp(
        window?.service_window_started_at ?? window?.last_inbound_at
      );
  const closesAt = formatTimestamp(expirationValue);
  const remainingProgress =
    window?.state === 'open' && expiresAt !== null
      ? Math.min(
          100,
          Math.max(0, ((expiresAt - now) / WINDOW_DURATION_MS) * 100)
        )
      : 0;
  const remaining =
    window?.state === 'open' && expiresAt !== null
      ? formatRemaining(expiresAt, now)
      : null;

  return (
    <View
      style={[
        styles.card,
        presentation.tone === 'open'
          ? styles.openCard
          : presentation.tone === 'awaiting'
            ? styles.awaitingCard
            : presentation.tone === 'uncertain'
              ? styles.uncertainCard
              : styles.closedCard,
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.statusHeader}>
        <View
          style={[
            styles.iconWrap,
            presentation.tone === 'open'
              ? styles.openIconWrap
              : presentation.tone === 'awaiting'
                ? styles.awaitingIconWrap
                : presentation.tone === 'uncertain'
                  ? styles.uncertainIconWrap
                  : styles.closedIconWrap,
          ]}
        >
          <Ionicons
            name={presentation.icon}
            size={19}
            color={
              presentation.tone === 'open'
                ? '#067647'
                : presentation.tone === 'awaiting'
                  ? '#B54708'
                  : presentation.tone === 'uncertain'
                    ? '#175CD3'
                    : '#475467'
            }
          />
        </View>
        <View style={styles.headerCopy}>
          <Text
            style={[
              styles.eyebrow,
              presentation.tone === 'open'
                ? styles.openText
                : presentation.tone === 'awaiting'
                  ? styles.awaitingText
                  : presentation.tone === 'uncertain'
                    ? styles.uncertainText
                    : styles.closedText,
            ]}
          >
            {presentation.eyebrow}
          </Text>
          <Text style={styles.title}>{presentation.title}</Text>
        </View>
      </View>

      <Text style={styles.description}>{presentation.description}</Text>

      {startedAt || closesAt ? (
        <View style={styles.timeGrid}>
          {startedAt ? (
            <View style={styles.timeItem}>
              <Text style={styles.timeLabel}>
                {window?.state === 'send_uncertain'
                  ? pt.official_window_template_requested_at
                  : window?.state === 'awaiting_contact_reply'
                    ? pt.official_window_template_sent_at
                    : pt.official_window_started_at}
              </Text>
              <Text style={styles.timeValue}>{startedAt}</Text>
            </View>
          ) : null}
          {closesAt ? (
            <View style={styles.timeItem}>
              <Text style={styles.timeLabel}>
                {window?.state === 'send_uncertain'
                  ? pt.official_window_uncertain_expires_at
                  : window?.state === 'awaiting_contact_reply'
                    ? pt.official_window_reply_wait_expires_at
                    : pt.official_window_closes_at}
              </Text>
              <Text style={styles.timeValue}>{closesAt}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {remaining ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressLabels}>
            <Text style={styles.progressLabel}>
              {pt.official_window_remaining}
            </Text>
            <Text style={styles.progressValueText}>{remaining}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressValue,
                { width: `${remainingProgress}%` as `${number}%` },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    borderCurve: 'continuous',
    padding: 14,
    gap: 11,
  },
  openCard: {
    borderColor: '#ABEFC6',
    backgroundColor: '#ECFDF3',
  },
  awaitingCard: {
    borderColor: '#FEDF89',
    backgroundColor: '#FFFAEB',
  },
  uncertainCard: {
    borderColor: '#B2DDFF',
    backgroundColor: '#EFF8FF',
  },
  closedCard: {
    borderColor: '#D0D5DD',
    backgroundColor: '#F8FAFC',
  },
  errorCard: {
    borderColor: '#FECDCA',
    backgroundColor: '#FEF3F2',
  },
  loadingCard: {
    minHeight: 105,
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: colors.grey200,
    backgroundColor: colors.grey50,
  },
  loadingCopy: {
    flex: 1,
    gap: 9,
  },
  skeleton: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.grey200,
  },
  skeletonTitle: {
    width: '58%',
  },
  skeletonLine: {
    width: '88%',
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openIconWrap: {
    backgroundColor: '#D1FADF',
  },
  awaitingIconWrap: {
    backgroundColor: '#FEF0C7',
  },
  uncertainIconWrap: {
    backgroundColor: '#D1E9FF',
  },
  closedIconWrap: {
    backgroundColor: '#EAECF0',
  },
  errorIconWrap: {
    backgroundColor: '#FEE4E2',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  openText: {
    color: '#067647',
  },
  awaitingText: {
    color: '#B54708',
  },
  uncertainText: {
    color: '#175CD3',
  },
  closedText: {
    color: '#475467',
  },
  errorText: {
    color: '#B42318',
  },
  title: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '700',
  },
  description: {
    color: '#475467',
    fontSize: 13,
    lineHeight: 19,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeItem: {
    flexGrow: 1,
    flexBasis: 130,
    borderWidth: 1,
    borderColor: 'rgba(71, 84, 103, 0.14)',
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  timeLabel: {
    color: '#667085',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timeValue: {
    color: '#344054',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBlock: {
    gap: 6,
  },
  progressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  progressLabel: {
    color: '#475467',
    fontSize: 11,
    fontWeight: '600',
  },
  progressValueText: {
    color: '#067647',
    fontSize: 11,
    fontWeight: '800',
  },
  progressTrack: {
    height: 5,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(6, 118, 71, 0.14)',
  },
  progressValue: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#12B76A',
  },
  retryButton: {
    minHeight: 38,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  retryButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
});

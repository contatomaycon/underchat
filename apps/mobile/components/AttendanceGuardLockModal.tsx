import { Modal, StyleSheet, Text, View } from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import type { AttendanceGuardStatus } from '../types/attendanceHours';

type Props = {
  visible: boolean;
  status: AttendanceGuardStatus | null;
  message?: string | null;
};

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function AttendanceGuardLockModal({ visible, status, message }: Props) {
  const todayWindows = status?.today_windows_label ?? '--';
  const nextUnlock = formatDateTime(status?.next_unlock_at);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{pt.attendance_guard_locked_title}</Text>
          <Text style={styles.description}>
            {message || pt.attendance_guard_locked_description}
          </Text>

          <View style={styles.block}>
            <Text style={styles.label}>
              {pt.attendance_guard_today_windows}
            </Text>
            <Text style={styles.value}>{todayWindows}</Text>
          </View>

          {nextUnlock ? (
            <View style={styles.block}>
              <Text style={styles.label}>
                {pt.attendance_guard_next_unlock}
              </Text>
              <Text style={styles.value}>{nextUnlock}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 9, 22, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 12,
  },
  title: {
    color: colors.onSurface,
    fontSize: 24,
    fontWeight: '700',
  },
  description: {
    color: colors.grey700,
    fontSize: 14,
  },
  block: {
    marginTop: 4,
    backgroundColor: colors.grey100,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  label: {
    color: colors.grey600,
    fontSize: 12,
  },
  value: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '600',
  },
});

import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors } from '../theme/colors';
import type { UploadProgressStatus } from '../types/uploadProgress';

type UploadProgressBadgeProps = {
  progress: number;
  status?: UploadProgressStatus;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const STROKE_WIDTH = 2;
const RING_EDGE_INSET = 1;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(99, Math.round(progress)));
}

export function UploadProgressBadge({
  progress,
  status = 'uploading',
  size = 24,
  style,
}: UploadProgressBadgeProps) {
  const normalizedProgress = clampProgress(progress);
  const isError = status === 'error';
  const center = size / 2;
  const radius = Math.max(0, (size - STROKE_WIDTH - RING_EDGE_INSET) / 2);
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (normalizedProgress / 100) * circumference;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        isError && styles.badgeError,
        style,
      ]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={
            isError ? 'rgba(255, 76, 81, 0.2)' : 'rgba(40, 101, 183, 0.18)'
          }
          strokeWidth={STROKE_WIDTH}
          fill="transparent"
        />
        <G originX={center} originY={center} rotation="-90">
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={isError ? colors.error : colors.primary}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={isError ? 0 : strokeDashoffset}
            fill="transparent"
          />
        </G>
      </Svg>
      <Text style={[styles.label, isError && styles.labelError]}>
        {isError ? '!' : `${normalizedProgress}%`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  badgeError: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  label: {
    color: colors.primary,
    fontSize: 7.5,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 9,
    textAlign: 'center',
  },
  labelError: {
    color: colors.error,
    fontSize: 10,
    lineHeight: 12,
  },
});

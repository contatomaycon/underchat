import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';
import type { UploadProgressStatus } from '../types/uploadProgress';

type UploadProgressBadgeProps = {
  progress: number;
  status?: UploadProgressStatus;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const STROKE_WIDTH = 3;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(99, Math.round(progress)));
}

export function UploadProgressBadge({
  progress,
  status = 'uploading',
  size = 38,
  style,
}: UploadProgressBadgeProps) {
  const normalizedProgress = clampProgress(progress);
  const radius = (size - STROKE_WIDTH * 2) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (normalizedProgress / 100) * circumference;
  const isError = status === 'error';

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
            isError ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.45)'
          }
          strokeWidth={STROKE_WIDTH}
          fill="transparent"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={isError ? colors.error : colors.primaryDarken1}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={isError ? 0 : strokeDashoffset}
          fill="transparent"
          originX={center}
          originY={center}
          rotation="-90"
        />
      </Svg>
      <Text style={styles.label}>
        {isError ? '!' : `${normalizedProgress}%`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    overflow: 'hidden',
  },
  badgeError: {
    backgroundColor: 'rgba(255, 76, 81, 0.9)',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 12,
    textAlign: 'center',
  },
});

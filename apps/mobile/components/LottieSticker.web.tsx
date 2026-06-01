import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type LottieStickerProps = {
  src?: string | null;
  size?: number;
};

export function LottieSticker({ size = 100 }: LottieStickerProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Text style={styles.text}>Sticker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.grey100,
  },
  text: {
    color: colors.grey600,
    fontSize: 12,
    fontWeight: '700',
  },
});

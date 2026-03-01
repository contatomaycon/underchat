import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { resolveImageUri } from '../utils/imageUri';

type AppAvatarProps = {
  uri?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  placeholderStyle?: StyleProp<ViewStyle>;
  iconName?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  iconColor?: string;
  resizeMode?: ImageResizeMode;
};

export function AppAvatar({
  uri,
  size,
  style,
  imageStyle,
  placeholderStyle,
  iconName = 'person',
  iconSize,
  iconColor = colors.grey600,
  resizeMode = 'cover',
}: AppAvatarProps) {
  const [hasLoadError, setHasLoadError] = useState(false);
  const resolvedUri = useMemo(() => resolveImageUri(uri), [uri]);

  useEffect(() => {
    setHasLoadError(false);
  }, [resolvedUri]);

  const showImage = !!resolvedUri && !hasLoadError;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: resolvedUri }}
          resizeMode={resizeMode}
          style={[
            styles.image,
            {
              borderRadius: size / 2,
            },
            imageStyle,
          ]}
          onError={() => setHasLoadError(true)}
        />
      ) : (
        <View style={[styles.placeholder, placeholderStyle]}>
          <Ionicons
            name={iconName}
            size={iconSize ?? Math.round(size * 0.5)}
            color={iconColor}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey200,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

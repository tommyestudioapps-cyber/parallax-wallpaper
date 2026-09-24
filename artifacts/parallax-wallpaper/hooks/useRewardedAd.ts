import { useCallback } from 'react';
import { Alert } from 'react-native';

export function useRewardedAd(_onRewardEarned: () => void) {
  return useCallback(() => {
    Alert.alert(
      'Vídeo de recompensa',
      'O vídeo de recompensa está disponível no app para Android e iOS.',
    );
  }, []);
}
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

type Cleanup = () => void;

export function useRewardedAd(onRewardEarned: () => void) {
  const onRewardEarnedRef = useRef(onRewardEarned);
  const rewardedAdRef = useRef<RewardedAd | null>(null);
  const cleanupsRef = useRef<Cleanup[]>([]);
  const loadRewardedAdRef = useRef<() => void>(() => {});
  const mountedRef = useRef(false);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  const showingRef = useRef(false);

  onRewardEarnedRef.current = onRewardEarned;

  const clearListeners = useCallback(() => {
    cleanupsRef.current.forEach((cleanup) => cleanup());
    cleanupsRef.current = [];
  }, []);

  const loadRewardedAd = useCallback(() => {
    if (!mountedRef.current || loadingRef.current || showingRef.current) return;

    clearListeners();
    loadedRef.current = false;
    loadingRef.current = true;

    let rewardedAd: RewardedAd;
    try {
      rewardedAd = RewardedAd.createForAdRequest(TestIds.REWARDED);
    } catch {
      loadingRef.current = false;
      return;
    }

    rewardedAdRef.current = rewardedAd;
    let rewardEarned = false;

    cleanupsRef.current = [
      rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
        if (rewardedAdRef.current !== rewardedAd) return;
        loadingRef.current = false;
        loadedRef.current = true;
      }),
      rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        if (rewardedAdRef.current !== rewardedAd || rewardEarned) return;
        rewardEarned = true;
        onRewardEarnedRef.current();
      }),
      rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
        if (rewardedAdRef.current !== rewardedAd) return;
        showingRef.current = false;
        loadingRef.current = false;
        loadedRef.current = false;
        rewardedAdRef.current = null;
        clearListeners();
        loadRewardedAdRef.current();
      }),
      rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
        if (rewardedAdRef.current !== rewardedAd) return;
        const failedWhileShowing = showingRef.current;
        showingRef.current = false;
        loadingRef.current = false;
        loadedRef.current = false;
        rewardedAdRef.current = null;
        clearListeners();
        if (failedWhileShowing) {
          Alert.alert('Não foi possível reproduzir o vídeo', 'Tente novamente em alguns instantes.');
          loadRewardedAdRef.current();
        }
      }),
    ];

    try {
      rewardedAd.load();
    } catch {
      loadingRef.current = false;
      loadedRef.current = false;
      rewardedAdRef.current = null;
      clearListeners();
    }
  }, [clearListeners]);

  loadRewardedAdRef.current = loadRewardedAd;

  useEffect(() => {
    mountedRef.current = true;
    loadRewardedAd();

    return () => {
      mountedRef.current = false;
      showingRef.current = false;
      loadingRef.current = false;
      loadedRef.current = false;
      rewardedAdRef.current = null;
      clearListeners();
    };
  }, [clearListeners, loadRewardedAd]);

  return useCallback(() => {
    if (showingRef.current) return;

    const rewardedAd = rewardedAdRef.current;
    if (!rewardedAd || !loadedRef.current || !rewardedAd.loaded) {
      Alert.alert(
        'Anúncio carregando',
        'Carregando o vídeo. Tente novamente em alguns instantes.',
      );
      loadRewardedAdRef.current();
      return;
    }

    loadedRef.current = false;
    showingRef.current = true;
    rewardedAd.show().catch(() => {
      if (rewardedAdRef.current !== rewardedAd) return;
      showingRef.current = false;
      loadingRef.current = false;
      loadedRef.current = false;
      rewardedAdRef.current = null;
      clearListeners();
      Alert.alert('Não foi possível reproduzir o vídeo', 'Tente novamente em alguns instantes.');
      loadRewardedAdRef.current();
    });
  }, [clearListeners]);
}
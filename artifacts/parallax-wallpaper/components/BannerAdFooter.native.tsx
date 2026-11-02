import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

type BannerAdFooterProps = {
  backgroundColor: string;
  borderColor: string;
  bottomInset: number;
};

const BANNER_AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : 'ca-app-pub-6305008666977043/7435940728';

export default function BannerAdFooter({
  backgroundColor,
  borderColor,
  bottomInset,
}: BannerAdFooterProps) {
  return (
    <View
      style={[
        styles.footer,
        {
          backgroundColor,
          borderTopColor: borderColor,
          paddingBottom: Math.max(bottomInset, 8),
        },
      ]}
    >
      <BannerAd
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
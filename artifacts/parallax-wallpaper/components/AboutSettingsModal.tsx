import React from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface AboutSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function AboutSettingsModal({ visible, onClose }: AboutSettingsModalProps) {
  const colors = useColors();

  const handleSendFeedback = () => {
    const url = 'mailto:tommyestudioapps@gmail.com?subject=Feedback%20Parallax%20Wallpaper%20Maker';
    Linking.openURL(url).catch(() => {
      Alert.alert('Suporte', 'Envie seu feedback para tommyestudioapps@gmail.com');
    });
  };

  const handleRateApp = () => {
    const url =
      Platform.OS === 'android'
        ? 'market://details?id=com.parallaxwallpaper.app'
        : 'https://play.google.com/store/apps/details?id=com.parallaxwallpaper.app';
    Linking.openURL(url).catch(() => {
      Alert.alert('Avaliação', 'Obrigado por apoiar o Parallax Wallpaper Maker!');
    });
  };

  const handleDeveloperPage = () => {
    const url = 'https://play.google.com/store/search?q=pub:Tommy%20Studio%20Apps&c=apps';
    Linking.openURL(url).catch(() => {
      Alert.alert('Tommy Studio Apps', 'Conheça nossos aplicativos oficiais na Google Play.');
    });
  };

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={[styles.kicker, { color: colors.primary }]}>TOMMY STUDIO APPS</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>Sobre & Informações</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar modal"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: colors.secondary },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="close-outline" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Seção 1: Privacidade & Segurança */}
            <View style={[styles.privacyCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <View style={styles.privacyHeader}>
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={colors.success || '#6EE7B7'} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Processamento 100% Local</Text>
              </View>
              <Text style={[styles.cardDescription, { color: colors.mutedForeground }]}>
                Suas fotos e composições nunca saem do seu aparelho. Todo o recorte de IA e a renderização 3D ocorrem exclusivamente no hardware do celular, sem envio para servidores externos ou nuvem.
              </Text>
            </View>

            {/* Divisor */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Seção 2: Sobre & Suporte */}
            <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>OPÇÕES & SUPORTE</Text>

            <View style={styles.list}>
              {/* Item 1: Enviar Feedback */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enviar feedback"
                onPress={handleSendFeedback}
                style={({ pressed }) => [
                  styles.listItem,
                  { backgroundColor: colors.background, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, { color: colors.foreground }]}>Enviar Feedback</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.mutedForeground }]}>
                    Compartilhe ideias ou relate um problema
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </Pressable>

              {/* Item 2: Avaliar o Aplicativo */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Avaliar aplicativo"
                onPress={handleRateApp}
                style={({ pressed }) => [
                  styles.listItem,
                  { backgroundColor: colors.background, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="star-outline" size={18} color="#FBBF24" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, { color: colors.foreground }]}>Avaliar o Aplicativo</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.mutedForeground }]}>
                    Ajude outros usuários na Google Play
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </Pressable>

              {/* Item 3: Tommy Studio Apps */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tommy Studio Apps"
                onPress={handleDeveloperPage}
                style={({ pressed }) => [
                  styles.listItem,
                  { backgroundColor: colors.background, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="grid-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, { color: colors.foreground }]}>Tommy Studio Apps</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.mutedForeground }]}>
                    Conheça nossos aplicativos oficiais
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </Pressable>

              {/* Item 4: Créditos & Tecnologias */}
              <View style={[styles.listItem, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="hardware-chip-outline" size={18} color="#6EE7B7" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, { color: colors.foreground }]}>Motor Gráfico & IA Local</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.mutedForeground }]}>
                    OpenGL ES + ML Kit Segmentation + Reanimated Sensors
                  </Text>
                </View>
              </View>

              {/* Item 5: Versão */}
              <View style={[styles.listItem, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.mutedForeground} />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, { color: colors.foreground }]}>Versão do Aplicativo</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.mutedForeground }]}>
                    v1.0.0 (Release Build)
                  </Text>
                </View>
                <View style={[styles.versionBadge, { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
                  <Text style={[styles.versionBadgeText, { color: colors.primary }]}>OFICIAL</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 4, 12, 0.75)',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitleContainer: {
    flex: 1,
  },
  kicker: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  scrollContent: {
    paddingBottom: 16,
  },
  privacyCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  cardDescription: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Inter_400Regular',
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: 14,
  },
  sectionHeading: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  list: {
    gap: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  itemCopy: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  itemSubtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  versionBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  versionBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
});

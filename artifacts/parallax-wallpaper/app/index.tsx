import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { DeviceMotion } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORAGE_KEY = '@parallax-wallpaper/project';
const CANVAS_WIDTH = Math.min(SCREEN_WIDTH - 40, 390);
const CANVAS_HEIGHT = Math.min(SCREEN_HEIGHT * 0.57, 590);

type LayerId = 'background' | 'middle' | 'foreground';
type ScreenMode = 'home' | 'edit' | 'compose' | 'preview';

type Layer = {
  id: LayerId;
  label: string;
  eyebrow: string;
  helper: string;
  uri: string | null;
  brightness: number;
  contrast: number;
  saturation: number;
  crop: number;
  scale: number;
  x: number;
  y: number;
};

type Project = {
  layers: Record<LayerId, Layer>;
  intensity: number;
  activeLayer: LayerId;
};

const layerMeta: Record<LayerId, Pick<Layer, 'label' | 'eyebrow' | 'helper'>> = {
  background: {
    label: 'Fundo',
    eyebrow: 'CAMADA 01',
    helper: 'A paisagem base, sem recorte',
  },
  middle: {
    label: 'Intermediária',
    eyebrow: 'CAMADA 02',
    helper: 'Profundidade do meio, com recorte',
  },
  foreground: {
    label: 'Frontal',
    eyebrow: 'CAMADA 03',
    helper: 'O elemento mais próximo, com recorte',
  },
};

function createLayer(id: LayerId): Layer {
  return {
    id,
    ...layerMeta[id],
    uri: null,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    crop: 0,
    scale: id === 'background' ? 1 : 0.78,
    x: 0,
    y: 0,
  };
}

function createProject(): Project {
  return {
    layers: {
      background: createLayer('background'),
      middle: createLayer('middle'),
      foreground: createLayer('foreground'),
    },
    intensity: 54,
    activeLayer: 'middle',
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function persistProject(project: Project) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Local persistence is best effort; the editor remains fully usable.
  }
}

function IconButton({
  name,
  onPress,
  colors,
  label,
  active = false,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  label?: string;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      testID={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: active ? colors.primary : colors.secondary },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={name} size={20} color={active ? colors.primaryForeground : colors.foreground} />
    </Pressable>
  );
}

function PrimaryButton({
  title,
  onPress,
  colors,
  icon,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      testID={title}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        {
          backgroundColor: secondary ? colors.secondary : colors.primary,
          borderColor: secondary ? colors.border : colors.primary,
          opacity: disabled ? 0.4 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <Text style={[styles.primaryButtonText, { color: secondary ? colors.foreground : colors.primaryForeground }]}>
        {title}
      </Text>
      {icon ? (
        <Ionicons name={icon} size={18} color={secondary ? colors.foreground : colors.primaryForeground} />
      ) : null}
    </Pressable>
  );
}

function Progress({ mode, colors }: { mode: ScreenMode; colors: ReturnType<typeof useColors> }) {
  const steps = [
    { key: 'home', label: 'Importar' },
    { key: 'compose', label: 'Compor' },
    { key: 'preview', label: 'Visualizar' },
  ];
  const current = mode === 'edit' ? 0 : mode === 'home' ? 0 : mode === 'compose' ? 1 : 2;
  return (
    <View style={styles.progressWrap}>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          <View style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                { backgroundColor: index <= current ? colors.primary : colors.secondary, borderColor: colors.border },
              ]}
            >
              {index < current ? <Ionicons name="checkmark" size={11} color={colors.primaryForeground} /> : null}
            </View>
            <Text style={[styles.progressLabel, { color: index <= current ? colors.foreground : colors.mutedForeground }]}>
              {step.label}
            </Text>
          </View>
          {index < steps.length - 1 ? (
            <View style={[styles.progressLine, { backgroundColor: index < current ? colors.primary : colors.border }]} />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

function Slider({
  value,
  min,
  max,
  onChange,
  colors,
  testID,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  colors: ReturnType<typeof useColors>;
  testID: string;
}) {
  const trackWidth = useRef(0);
  const updateFromX = useCallback(
    (x: number) => {
      if (!trackWidth.current) return;
      onChange(clamp(min + (x / trackWidth.current) * (max - min), min, max));
    },
    [max, min, onChange],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => updateFromX(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateFromX(event.nativeEvent.locationX),
      }),
    [updateFromX],
  );
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <View
      testID={testID}
      onLayout={(event) => {
        trackWidth.current = event.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}
      style={styles.sliderTouchArea}
    >
      <View style={[styles.sliderTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.sliderFill, { width: `${percentage}%`, backgroundColor: colors.primary }]} />
        <View
          style={[
            styles.sliderThumb,
            { left: `${percentage}%`, backgroundColor: colors.primary, borderColor: colors.background },
          ]}
        />
      </View>
    </View>
  );
}

function LayerPreview({
  layer,
  colors,
  selected,
  onPress,
}: {
  layer: Layer;
  colors: ReturnType<typeof useColors>;
  selected?: boolean;
  onPress?: () => void;
}) {
  const tint = layer.saturation < -10 ? colors.secondary : layer.brightness > 10 ? colors.accent : undefined;
  return (
    <Pressable
      testID={`layer-${layer.id}`}
      onPress={onPress}
      style={[
        styles.layerPreview,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: colors.muted,
          transform: [{ translateX: layer.x }, { translateY: layer.y }, { scale: layer.scale }],
        },
      ]}
    >
      {layer.uri ? (
        <>
          <Image source={{ uri: layer.uri }} style={styles.layerImage} resizeMode="cover" />
          {tint ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.14 }]} /> : null}
          {layer.brightness > 15 ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.foreground, opacity: 0.08 }]} />
          ) : null}
        </>
      ) : (
        <View style={styles.previewPlaceholder}>
          <Ionicons name={layer.id === 'background' ? 'image-outline' : 'person-outline'} size={24} color={colors.mutedForeground} />
        </View>
      )}
    </Pressable>
  );
}

function Header({
  title,
  subtitle,
  colors,
  onBack,
  onReset,
}: {
  title: string;
  subtitle?: string;
  colors: ReturnType<typeof useColors>;
  onBack?: () => void;
  onReset?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? <IconButton name="chevron-back" onPress={onBack} colors={colors} label="Voltar" /> : <View style={styles.headerSpacer} />}
      <View style={styles.headerTitleWrap}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {onReset ? <IconButton name="refresh-outline" onPress={onReset} colors={colors} label="Recomeçar" /> : <View style={styles.headerSpacer} />}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [project, setProject] = useState<Project>(createProject);
  const [mode, setMode] = useState<ScreenMode>('home');
  const [editingLayer, setEditingLayer] = useState<LayerId>('background');
  const [isLoading, setIsLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [applied, setApplied] = useState(false);
  const motionX = useRef(new Animated.Value(0)).current;
  const motionY = useRef(new Animated.Value(0)).current;
  const projectRef = useRef(project);
  const gestureStart = useRef({ x: 0, y: 0, scale: 1, distance: 0 });
  projectRef.current = project;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          try {
            setProject(JSON.parse(stored) as Project);
          } catch {
            setProject(createProject());
          }
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!isLoading) {
      persistProject(project);
    }
  }, [isLoading, project]);

  const updateLayer = useCallback((id: LayerId, patch: Partial<Layer>) => {
    setProject((current) => ({ ...current, layers: { ...current.layers, [id]: { ...current.layers[id], ...patch } } }));
  }, []);

  const pickLayer = useCallback(
    async (id: LayerId) => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Acesso às fotos', 'Permita o acesso à sua galeria para adicionar uma camada.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      setProcessing(true);
      try {
        const asset = result.assets[0];
        const maxDimension = 1440;
        const largest = Math.max(asset.width ?? maxDimension, asset.height ?? maxDimension);
        const resize = largest > maxDimension ? [{ resize: { width: asset.width && asset.width >= (asset.height ?? 0) ? maxDimension : undefined, height: asset.height && asset.height > (asset.width ?? 0) ? maxDimension : undefined } }] : [];
        const optimized = await ImageManipulator.manipulateAsync(asset.uri, resize, {
          compress: 0.72,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        updateLayer(id, { uri: optimized.uri });
        setEditingLayer(id);
        setMode('edit');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Alert.alert('Não foi possível importar', 'Tente selecionar outra imagem da galeria.');
      } finally {
        setProcessing(false);
      }
    },
    [updateLayer],
  );

  const resetProject = () => {
    Alert.alert('Começar de novo?', 'As três camadas atuais serão removidas deste aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          const next = createProject();
          setProject(next);
          setMode('home');
          AsyncStorage.removeItem(STORAGE_KEY);
        },
      },
    ]);
  };

  const goToCompose = () => {
    if (!project.layers.background.uri || !project.layers.middle.uri || !project.layers.foreground.uri) {
      Alert.alert('Faltam camadas', 'Adicione uma imagem em cada um dos três espaços para continuar.');
      return;
    }
    setMode('compose');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const applyWallpaper = async () => {
    setApplied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL('intent:#Intent;action=android.service.wallpaper.LIVE_WALLPAPER_CHOOSER;end');
      } catch {
        Alert.alert('Aplicar wallpaper', 'O seletor nativo não está disponível neste preview. No Android, abra a opção de papel de parede do sistema para concluir.');
      }
    } else {
      Alert.alert('Wallpaper criado', 'A prévia está pronta. A aplicação automática no iOS fica disponível quando o app for instalado como build nativo.');
    }
  };

  useEffect(() => {
    if (mode !== 'preview') return;
    if (Platform.OS === 'web') return;
    DeviceMotion.setUpdateInterval(32);
    const subscription = DeviceMotion.addListener((data) => {
      const beta = data.rotationRate?.beta ?? 0;
      const gamma = data.rotationRate?.gamma ?? 0;
      Animated.parallel([
        Animated.spring(motionX, { toValue: clamp(gamma * 1.9 * (project.intensity / 60), -18, 18), useNativeDriver: true, speed: 8, bounciness: 5 }),
        Animated.spring(motionY, { toValue: clamp(beta * 1.2 * (project.intensity / 60), -12, 12), useNativeDriver: true, speed: 8, bounciness: 5 }),
      ]).start();
    });
    return () => subscription.remove();
  }, [mode, motionX, motionY, project.intensity]);

  const edit = project.layers[editingLayer];
  const allReady = Object.values(project.layers).every((layer) => Boolean(layer.uri));
  const canvasResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const layer = projectRef.current.layers[projectRef.current.activeLayer];
          const touches = event.nativeEvent.touches;
          const distance =
            touches.length >= 2
              ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
              : 0;
          gestureStart.current = { x: layer.x, y: layer.y, scale: layer.scale, distance };
          Haptics.selectionAsync();
        },
        onPanResponderMove: (event, gestureState) => {
          const touches = event.nativeEvent.touches;
          const activeLayer = projectRef.current.activeLayer;
          if (touches.length >= 2 && gestureStart.current.distance > 0) {
            const distance = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            const nextScale = clamp(
              gestureStart.current.scale * (distance / gestureStart.current.distance),
              0.55,
              1.25,
            );
            updateLayer(activeLayer, { scale: nextScale });
          } else if (activeLayer !== 'background') {
            updateLayer(activeLayer, {
              x: clamp(gestureStart.current.x + gestureState.dx, -80, 80),
              y: clamp(gestureStart.current.y + gestureState.dy, -100, 100),
            });
          }
        },
      }),
    [updateLayer],
  );

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.logoMark, { backgroundColor: colors.primary }]}>
          <Ionicons name="layers-outline" size={28} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Abrindo seu estúdio…</Text>
      </View>
    );
  }

  if (mode === 'preview') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header title="Preview fluido" subtitle="Mova o aparelho para sentir a profundidade" colors={colors} onBack={() => setMode('compose')} />
        <View style={styles.previewScreenBody}>
          <View style={[styles.previewFrame, { borderColor: colors.border }]}>
            <Animated.View style={[styles.previewLayer, { transform: [{ translateX: motionX }, { translateY: motionY }] }]}>
              <LayerPreview layer={project.layers.background} colors={colors} />
            </Animated.View>
            <Animated.View style={[styles.previewLayer, { transform: [{ translateX: Animated.multiply(motionX, 1.7) }, { translateY: Animated.multiply(motionY, 1.7) }] }]}>
              <LayerPreview layer={project.layers.middle} colors={colors} />
            </Animated.View>
            <Animated.View style={[styles.previewLayer, { transform: [{ translateX: Animated.multiply(motionX, 2.5) }, { translateY: Animated.multiply(motionY, 2.5) }] }]}>
              <LayerPreview layer={project.layers.foreground} colors={colors} />
            </Animated.View>
            <View style={styles.previewOverlayLabel}>
              <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
              <Text style={[styles.previewOverlayText, { color: colors.primary }]}>PARALLAX {project.intensity}%</Text>
            </View>
          </View>
          <View style={styles.previewCopy}>
            <Text style={[styles.previewTitle, { color: colors.foreground }]}>Seu wallpaper ganhou vida.</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              A suavização está ativa. Incline o celular devagar para explorar as três camadas.
            </Text>
          </View>
          <PrimaryButton title={applied ? 'Aplicado ao sistema' : 'Aplicar wallpaper'} onPress={applyWallpaper} colors={colors} icon={applied ? 'checkmark' : 'arrow-up-circle-outline'} />
          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            {Platform.OS === 'android' ? 'O Android abrirá o seletor nativo de wallpaper.' : 'A aplicação nativa estará disponível no build instalado.'}
          </Text>
        </View>
      </View>
    );
  }

  if (mode === 'compose') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header title="Composição" subtitle="Ajuste a distância entre os planos" colors={colors} onBack={() => setMode('edit')} onReset={resetProject} />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Progress mode={mode} colors={colors} />
          <Text style={[styles.sectionKicker, { color: colors.primary }]}>PRÉVIA DA CENA</Text>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>Dê espaço à sua visão.</Text>
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Toque em uma camada e arraste para reposicionar. Use os controles abaixo para refinar a escala.</Text>
          <View
            {...canvasResponder.panHandlers}
            style={[styles.composeCanvas, { backgroundColor: colors.muted, borderColor: colors.border }]}
          >
            <LayerPreview layer={project.layers.background} colors={colors} selected={project.activeLayer === 'background'} onPress={() => setProject((current) => ({ ...current, activeLayer: 'background' }))} />
            <LayerPreview layer={project.layers.middle} colors={colors} selected={project.activeLayer === 'middle'} onPress={() => setProject((current) => ({ ...current, activeLayer: 'middle' }))} />
            <LayerPreview layer={project.layers.foreground} colors={colors} selected={project.activeLayer === 'foreground'} onPress={() => setProject((current) => ({ ...current, activeLayer: 'foreground' }))} />
            <View style={[styles.canvasBadge, { backgroundColor: colors.background }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.canvasBadgeText, { color: colors.foreground }]}>TOQUE PARA EDITAR</Text>
            </View>
          </View>
          <View style={styles.layerPicker}>
            {(Object.keys(project.layers) as LayerId[]).map((id) => (
              <Pressable
                key={id}
                testID={`select-${id}`}
                onPress={() => setProject((current) => ({ ...current, activeLayer: id }))}
                style={[
                  styles.layerPickerItem,
                  {
                    backgroundColor: project.activeLayer === id ? colors.primary : colors.secondary,
                    borderColor: project.activeLayer === id ? colors.primary : colors.border,
                  },
                ]}
              >
                <View style={[styles.layerPickerDot, { backgroundColor: project.activeLayer === id ? colors.primaryForeground : colors.mutedForeground }]} />
                <Text style={[styles.layerPickerText, { color: project.activeLayer === id ? colors.primaryForeground : colors.mutedForeground }]}>
                  {layerMeta[id].label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.gestureHint, { color: colors.mutedForeground }]}>
            <Ionicons name="hand-left-outline" size={13} color={colors.primary} /> Arraste para mover · use dois dedos para escalar
          </Text>
          <View style={[styles.controlCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.controlHeader}>
              <View>
                <Text style={[styles.controlLabel, { color: colors.foreground }]}>Camada ativa</Text>
                <Text style={[styles.controlValue, { color: colors.primary }]}>{layerMeta[project.activeLayer].label}</Text>
              </View>
              <View style={[styles.controlIcon, { backgroundColor: colors.secondary }]}>
                <Ionicons name="move-outline" size={19} color={colors.primary} />
              </View>
            </View>
            <Text style={[styles.sliderLabel, { color: colors.mutedForeground }]}>Escala <Text style={{ color: colors.foreground }}>{Math.round(project.layers[project.activeLayer].scale * 100)}%</Text></Text>
            <Slider
              value={project.layers[project.activeLayer].scale}
              min={0.55}
              max={1.25}
              onChange={(value) => updateLayer(project.activeLayer, { scale: value })}
              colors={colors}
              testID="escala"
            />
          </View>
          <View style={[styles.controlCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.controlHeader}>
              <View>
                <Text style={[styles.controlLabel, { color: colors.foreground }]}>Intensidade do efeito</Text>
                <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>Quanto cada plano reage ao movimento</Text>
              </View>
              <Text style={[styles.intensityValue, { color: colors.primary }]}>{Math.round(project.intensity)}%</Text>
            </View>
            <Slider value={project.intensity} min={10} max={100} onChange={(value) => setProject((current) => ({ ...current, intensity: value }))} colors={colors} testID="intensidade" />
            <View style={styles.sliderEnds}>
              <Text style={[styles.sliderEndText, { color: colors.mutedForeground }]}>Sutil</Text>
              <Text style={[styles.sliderEndText, { color: colors.mutedForeground }]}>Imersivo</Text>
            </View>
          </View>
          <PrimaryButton title="Visualizar movimento" onPress={() => setMode('preview')} colors={colors} icon="play" />
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    );
  }

  if (mode === 'edit') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header title={edit.label} subtitle={`${edit.eyebrow}  ·  Ajustes locais`} colors={colors} onBack={() => setMode('home')} onReset={resetProject} />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Progress mode={mode} colors={colors} />
          <View style={[styles.editPreview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            {edit.uri ? <Image source={{ uri: edit.uri }} style={[styles.editImage, { transform: [{ scale: 1 + edit.crop / 180 }] }]} resizeMode="cover" /> : null}
            <View style={[styles.editOverlay, { backgroundColor: colors.background }]}>
              <Ionicons name={edit.uri ? 'checkmark-circle' : 'image-outline'} size={15} color={edit.uri ? colors.success : colors.mutedForeground} />
              <Text style={[styles.editOverlayText, { color: colors.foreground }]}>{edit.uri ? 'Imagem otimizada localmente' : 'Adicione uma imagem'}</Text>
            </View>
          </View>
          <View style={styles.editTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionKicker, { color: colors.primary }]}>{edit.eyebrow}</Text>
              <Text style={[styles.screenTitleSmall, { color: colors.foreground }]}>{edit.uri ? 'Refine esta camada' : 'Comece por aqui'}</Text>
            </View>
            <Pressable style={[styles.changeButton, { borderColor: colors.border, backgroundColor: colors.secondary }]} onPress={() => pickLayer(editingLayer)}>
              <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
              <Text style={[styles.changeButtonText, { color: colors.foreground }]}>Trocar</Text>
            </Pressable>
          </View>
          {edit.uri ? (
            <>
              <View style={[styles.controlCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.controlLabel, { color: colors.foreground }]}>Ajustes de cor</Text>
                {[
                  { key: 'brightness' as const, label: 'Brilho', icon: 'sunny-outline' as const },
                  { key: 'contrast' as const, label: 'Contraste', icon: 'contrast-outline' as const },
                  { key: 'saturation' as const, label: 'Saturação', icon: 'color-palette-outline' as const },
                ].map((control) => (
                  <View key={control.key} style={styles.editSliderRow}>
                    <Ionicons name={control.icon} size={17} color={colors.mutedForeground} />
                    <Text style={[styles.sliderLabel, { color: colors.mutedForeground }]}>{control.label}</Text>
                    <Slider value={edit[control.key]} min={-50} max={50} onChange={(value) => updateLayer(editingLayer, { [control.key]: value })} colors={colors} testID={control.label} />
                    <Text style={[styles.sliderNumber, { color: colors.foreground }]}>{Math.round(edit[control.key])}</Text>
                  </View>
                ))}
              </View>
              {editingLayer !== 'background' ? (
                <View style={[styles.cropCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <View style={styles.cropCopy}>
                    <View style={[styles.cropIcon, { backgroundColor: colors.primary }]}>
                      <Ionicons name="crop-outline" size={18} color={colors.primaryForeground} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.controlLabel, { color: colors.foreground }]}>Preparar recorte</Text>
                      <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>Ajuste o enquadramento antes da separação inteligente.</Text>
                    </View>
                  </View>
                  <Slider value={edit.crop} min={0} max={100} onChange={(value) => updateLayer(editingLayer, { crop: value })} colors={colors} testID="recorte" />
                </View>
              ) : (
                <View style={[styles.infoRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Ionicons name="layers-outline" size={18} color={colors.primary} />
                  <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>O fundo preserva o quadro inteiro. Sem corte nesta camada.</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.emptyEdit}>
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Suas imagens ficam apenas neste aparelho e são comprimidas automaticamente para manter o movimento leve.</Text>
              <PrimaryButton title="Escolher da galeria" onPress={() => pickLayer(editingLayer)} colors={colors} icon="images-outline" />
            </View>
          )}
          <View style={styles.editNav}>
            {editingLayer !== 'background' ? (
              <Pressable
                onPress={() => setEditingLayer(editingLayer === 'foreground' ? 'middle' : 'background')}
                style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-back" size={16} color={colors.primary} />
                <Text style={[styles.textButtonText, { color: colors.primary }]}>Anterior</Text>
              </Pressable>
            ) : <View />}
            <Pressable
              onPress={() => {
                if (editingLayer === 'background') setEditingLayer('middle');
                else if (editingLayer === 'middle') setEditingLayer('foreground');
                else goToCompose();
              }}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <Text style={[styles.textButtonText, { color: colors.primary }]}>{editingLayer === 'foreground' ? 'Ir para composição' : 'Próxima camada'}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </Pressable>
          </View>
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Header title="Parallax" subtitle="Wallpaper studio" colors={colors} onReset={allReady ? resetProject : undefined} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Progress mode={mode} colors={colors} />
        <View style={styles.hero}>
          <View style={[styles.heroKicker, { backgroundColor: colors.secondary }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.heroKickerText, { color: colors.primary }]}>OFFLINE · NO SEU APARELHO</Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Transforme fotos{'\n'}em <Text style={{ color: colors.primary }}>profundidade.</Text></Text>
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Crie um wallpaper vivo com três imagens e um movimento que parece real.</Text>
        </View>
        <View style={styles.layersHeader}>
          <View>
            <Text style={[styles.sectionKicker, { color: colors.primary }]}>SEU PROJETO</Text>
            <Text style={[styles.screenTitleSmall, { color: colors.foreground }]}>Monte as três camadas</Text>
          </View>
          <Text style={[styles.layerCount, { color: colors.mutedForeground }]}>{Object.values(project.layers).filter((layer) => layer.uri).length}/3 prontas</Text>
        </View>
        <View style={styles.layerList}>
          {(Object.keys(project.layers) as LayerId[]).map((id, index) => {
            const layer = project.layers[id];
            return (
              <Pressable
                key={id}
                testID={`slot-${id}`}
                onPress={() => {
                  setEditingLayer(id);
                  if (layer.uri) setMode('edit');
                  else pickLayer(id);
                }}
                style={({ pressed }) => [
                  styles.layerRow,
                  { backgroundColor: colors.card, borderColor: layer.uri ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={[styles.layerThumbnail, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  {layer.uri ? <Image source={{ uri: layer.uri }} style={styles.thumbnailImage} /> : <Ionicons name="add" size={20} color={colors.mutedForeground} />}
                </View>
                <View style={styles.layerRowCopy}>
                  <Text style={[styles.layerEyebrow, { color: colors.primary }]}>{layer.eyebrow}</Text>
                  <Text style={[styles.layerRowTitle, { color: colors.foreground }]}>{layer.label}</Text>
                  <Text style={[styles.layerRowHelper, { color: colors.mutedForeground }]}>{layer.uri ? 'Pronta para editar' : layer.helper}</Text>
                </View>
                <View style={[styles.layerStatus, { backgroundColor: layer.uri ? colors.primary : colors.secondary }]}>
                  <Ionicons name={layer.uri ? 'checkmark' : 'arrow-up-outline'} size={16} color={layer.uri ? colors.primaryForeground : colors.foreground} />
                </View>
                {index < 2 ? <View style={[styles.layerConnector, { backgroundColor: colors.border }]} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.tipCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Ionicons name="flash-outline" size={18} color={colors.accent} />
          <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>Dica: use fotos com elementos em distâncias diferentes para um efeito mais cinematográfico.</Text>
        </View>
        <PrimaryButton title={allReady ? 'Continuar para composição' : 'Adicionar primeira camada'} onPress={allReady ? goToCompose : () => pickLayer('background')} colors={colors} icon="arrow-forward" />
        {processing ? (
          <View style={styles.processingRow}>
            <Ionicons name="sync-outline" size={16} color={colors.primary} />
            <Text style={[styles.bodyTextSmall, { color: colors.primary }]}>Otimizando sua imagem…</Text>
          </View>
        ) : null}
        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  logoMark: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  header: { minHeight: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 38 },
  headerTitleWrap: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 3, letterSpacing: 0.3 },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.8 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 14 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 30 },
  progressStep: { alignItems: 'center', gap: 6 },
  progressDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  progressLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  progressLine: { flex: 1, height: 1, marginHorizontal: 8, marginBottom: 16 },
  hero: { paddingBottom: 28 },
  heroKicker: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, gap: 7, marginBottom: 16 },
  heroKickerText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  heroTitle: { fontSize: 38, lineHeight: 42, letterSpacing: -1.6, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  bodyText: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular' },
  bodyTextSmall: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular' },
  sectionKicker: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.4, marginBottom: 5 },
  screenTitle: { fontSize: 27, lineHeight: 32, letterSpacing: -0.7, fontFamily: 'Inter_700Bold', marginBottom: 7 },
  screenTitleSmall: { fontSize: 19, letterSpacing: -0.4, fontFamily: 'Inter_700Bold' },
  layersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  layerCount: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  layerList: { gap: 10, marginBottom: 18 },
  layerRow: { minHeight: 86, borderWidth: 1, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center' },
  layerThumbnail: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%' },
  layerRowCopy: { flex: 1, paddingHorizontal: 12 },
  layerEyebrow: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  layerRowTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  layerRowHelper: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 3 },
  layerStatus: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  layerConnector: { position: 'absolute', width: 1, height: 10, left: 41, bottom: -10, zIndex: 3 },
  tipCard: { borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 16 },
  primaryButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryButtonText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 14 },
  savedText: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter_500Medium', paddingTop: 12 },
  editPreview: { height: 230, borderRadius: 22, borderWidth: 1, overflow: 'hidden', marginBottom: 20 },
  editImage: { width: '100%', height: '100%' },
  editOverlay: { position: 'absolute', left: 12, bottom: 12, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.92 },
  editOverlayText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  editTitleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 15 },
  changeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11 },
  changeButtonText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  controlCard: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 12 },
  controlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  controlLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  controlValue: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 4 },
  controlIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  intensityValue: { fontSize: 21, fontFamily: 'Inter_700Bold' },
  sliderLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  sliderTouchArea: { height: 28, justifyContent: 'center', flex: 1, marginHorizontal: 10 },
  sliderTrack: { height: 4, borderRadius: 2, position: 'relative' },
  sliderFill: { height: 4, borderRadius: 2 },
  sliderThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: -6, marginLeft: -8, borderWidth: 3 },
  sliderEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderEndText: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  cropCard: { borderWidth: 1, borderRadius: 18, padding: 15, marginBottom: 12 },
  cropCopy: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  cropIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  infoRow: { borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  emptyEdit: { gap: 18, paddingVertical: 8 },
  editNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  textButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  textButtonText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  composeCanvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, alignSelf: 'center', borderRadius: 24, borderWidth: 1, overflow: 'hidden', marginTop: 20, marginBottom: 15, justifyContent: 'center', alignItems: 'center' },
  layerPicker: { flexDirection: 'row', width: '100%', gap: 7, marginBottom: 8 },
  layerPickerItem: { flex: 1, minHeight: 36, borderRadius: 11, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  layerPickerDot: { width: 5, height: 5, borderRadius: 3 },
  layerPickerText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  gestureHint: { textAlign: 'center', fontSize: 10, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  layerPreview: { position: 'absolute', width: '100%', height: '100%', borderWidth: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  layerImage: { width: '100%', height: '100%' },
  previewPlaceholder: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  canvasBadge: { position: 'absolute', left: 14, top: 14, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.9 },
  canvasBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.6 },
  previewScreenBody: { flex: 1, paddingHorizontal: 20, paddingTop: 12, alignItems: 'center' },
  previewFrame: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, borderRadius: 26, borderWidth: 1, overflow: 'hidden', backgroundColor: '#11151D' },
  previewLayer: { ...StyleSheet.absoluteFillObject },
  previewOverlayLabel: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#090B10CC', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  previewOverlayText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  previewCopy: { width: '100%', paddingVertical: 17 },
  previewTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 6, letterSpacing: -0.4 },
  footnote: { textAlign: 'center', fontSize: 10, fontFamily: 'Inter_400Regular', paddingTop: 12 },
  editSliderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 13 },
  sliderNumber: { width: 28, textAlign: 'right', fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
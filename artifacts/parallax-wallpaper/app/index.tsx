import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { DeviceMotion } from 'expo-sensors';
import { isNativeBackgroundRemovalSupported, removeBackground } from '@six33/react-native-bg-removal';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Image as SvgImage } from 'react-native-svg';
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
  enabled: boolean;
  crop: number;
  backgroundRemoved: boolean;
  scale: number;
  x: number;
  y: number;
};

type Project = {
  layers: Record<LayerId, Layer>;
  intensity: number;
  activeLayer: LayerId;
};

type CanvasGestureMode = 'idle' | 'pan' | 'pinch';

const LAYER_IDS: LayerId[] = ['background', 'middle', 'foreground'];
const MIN_GESTURE_SCALE = 0.12;
const MAX_GESTURE_SCALE = 6;
const PROJECT_PERSIST_DEBOUNCE_MS = 300;

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
    enabled: true,
    crop: 0,
    backgroundRemoved: false,
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

function shortestAngleDelta(current: number, baseline: number) {
  let delta = current - baseline;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function applyMotionDeadZone(value: number, deadZone: number) {
  if (Math.abs(value) <= deadZone) return 0;
  return Math.sign(value) * (Math.abs(value) - deadZone);
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

function Progress({
  mode,
  colors,
  editingLayer,
  onPreviousLayer,
  onNextLayer,
  inHeader = false,
}: {
  mode: ScreenMode;
  colors: ReturnType<typeof useColors>;
  editingLayer?: LayerId;
  onPreviousLayer?: () => void;
  onNextLayer?: () => void;
  inHeader?: boolean;
}) {
  const steps = [
    { key: 'home', label: 'Importar' },
    { key: 'compose', label: 'Compor' },
    { key: 'preview', label: 'Visualizar' },
  ];
  const current = mode === 'edit' ? 0 : mode === 'home' ? 0 : mode === 'compose' ? 1 : 2;
  const hasLayerNavigation = mode === 'edit' && editingLayer && onPreviousLayer && onNextLayer;
  return (
    <View style={[styles.progressWrap, inHeader && styles.progressHeader]}>
      {hasLayerNavigation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Camada anterior"
          disabled={editingLayer === 'background'}
          onPress={() => onPreviousLayer?.()}
          style={({ pressed }) => [
            styles.progressArrow,
            editingLayer === 'background' && styles.progressArrowDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={20} color={editingLayer === 'background' ? colors.mutedForeground : colors.primary} />
        </Pressable>
      ) : null}
      <View style={styles.progressSteps}>
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
      {hasLayerNavigation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editingLayer === 'foreground' ? 'Ir para composição' : 'Próxima camada'}
          onPress={() => onNextLayer?.()}
          style={({ pressed }) => [styles.progressArrow, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
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
  const [displayValue, setDisplayValue] = useState(value);
  const onChangeRef = useRef(onChange);
  const gestureStartValue = useRef(value);
  const pendingValue = useRef(value);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureActive = useRef(false);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!gestureActive.current) {
      pendingValue.current = value;
      setDisplayValue(value);
    }
  }, [value]);
  const publishValue = useCallback(
    (nextValue: number, immediate = false) => {
      pendingValue.current = nextValue;
      setDisplayValue(nextValue);
      if (immediate) {
        if (commitTimer.current) {
          clearTimeout(commitTimer.current);
          commitTimer.current = null;
        }
        onChangeRef.current(nextValue);
        return;
      }
      if (commitTimer.current) return;
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        onChangeRef.current(pendingValue.current);
      }, 32);
    },
    [],
  );
  const flushValue = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    onChangeRef.current(pendingValue.current);
  }, []);
  const updateFromDelta = useCallback(
    (deltaX: number) => {
      if (!trackWidth.current) return;
      publishValue(clamp(gestureStartValue.current + (deltaX / trackWidth.current) * (max - min), min, max));
    },
    [max, min, publishValue],
  );
  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          if (!trackWidth.current) return;
          gestureActive.current = true;
          gestureStartValue.current = clamp(min + (event.nativeEvent.locationX / trackWidth.current) * (max - min), min, max);
          publishValue(gestureStartValue.current, true);
        },
        onPanResponderMove: (_event, gestureState) => updateFromDelta(gestureState.dx),
        onPanResponderRelease: () => {
          gestureActive.current = false;
          flushValue();
        },
        onPanResponderTerminate: () => {
          gestureActive.current = false;
          flushValue();
        },
      }),
    [flushValue, max, min, publishValue, updateFromDelta],
  );
  const percentage = ((displayValue - min) / (max - min)) * 100;
  return (
    <View
      testID={testID}
      onLayout={(event) => {
        trackWidth.current = event.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}
      style={styles.sliderTouchArea}
    >
      <View pointerEvents="none" style={[styles.sliderTrack, { backgroundColor: colors.border }]}>
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

function LayerImage({
  uri,
  style,
  preserveAspectRatio = 'xMidYMid slice',
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  preserveAspectRatio?: string;
}) {
  return (
    <Svg style={style} viewBox="0 0 100 100">
      <SvgImage
        x="0"
        y="0"
        width="100"
        height="100"
        href={{ uri }}
        preserveAspectRatio={preserveAspectRatio}
      />
    </Svg>
  );
}

const transparencyCells = Array.from({ length: 64 }, (_, index) => ({
  index,
  dark: (Math.floor(index / 8) + (index % 8)) % 2 === 0,
}));

function TransparencyGrid({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.transparencyGrid, { backgroundColor: colors.secondary }]}>
      {transparencyCells.map((cell) => (
        <View
          key={cell.index}
          style={[styles.transparencyCell, { backgroundColor: cell.dark ? colors.card : colors.border }]}
        />
      ))}
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
  if (!layer.enabled) return null;
  return (
    <Pressable
      testID={`layer-${layer.id}`}
      onPress={onPress}
      style={[
        styles.layerPreview,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: layer.id === 'background' ? colors.muted : 'transparent',
          transform: [{ translateX: layer.x }, { translateY: layer.y }, { scale: layer.scale }],
        },
      ]}
    >
      {layer.uri ? (
        <LayerImage
          uri={layer.uri}
          style={styles.layerImage}
          preserveAspectRatio={layer.id === 'background' ? 'xMidYMid slice' : 'xMidYMid meet'}
        />
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
  const motionBaseline = useRef<{ beta: number; gamma: number } | null>(null);
  const filteredMotion = useRef({ x: 0, y: 0 });
  const projectRef = useRef(project);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureStart = useRef<{
    mode: CanvasGestureMode;
    x: number;
    y: number;
    scale: number;
    distance: number;
    focalX: number;
    focalY: number;
    pageX: number;
    pageY: number;
  }>({ mode: 'idle', x: 0, y: 0, scale: 1, distance: 0, focalX: 0, focalY: 0, pageX: 0, pageY: 0 });
  projectRef.current = project;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as Partial<Project>;
            const defaults = createProject();
            const layers = LAYER_IDS.reduce((result, id) => {
              const savedLayer = parsed.layers?.[id];
              result[id] = {
                ...defaults.layers[id],
                ...savedLayer,
                enabled: savedLayer?.enabled !== false,
              };
              return result;
            }, {} as Record<LayerId, Layer>);
            setProject({ ...defaults, ...parsed, layers });
          } catch {
            setProject(createProject());
          }
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      persistProject(project);
    }, PROJECT_PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [isLoading, project]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const updateLayer = useCallback((id: LayerId, patch: Partial<Layer>) => {
    setProject((current) => ({ ...current, layers: { ...current.layers, [id]: { ...current.layers[id], ...patch } } }));
  }, []);

  const toggleLayer = useCallback((id: LayerId) => {
    setProject((current) => {
      const nextEnabled = !current.layers[id].enabled;
      let activeLayer = current.activeLayer;
      if (!nextEnabled && activeLayer === id) {
        const fallback = LAYER_IDS.find(
          (candidate) => candidate !== id && current.layers[candidate].uri && current.layers[candidate].enabled,
        );
        if (fallback) activeLayer = fallback;
      }
      return {
        ...current,
        activeLayer,
        layers: { ...current.layers, [id]: { ...current.layers[id], enabled: nextEnabled } },
      };
    });
    Haptics.selectionAsync();
  }, []);

  const removeLayer = useCallback((id: LayerId) => {
    const label = projectRef.current.layers[id].label;
    Alert.alert(`Remover ${label.toLowerCase()}?`, 'A imagem selecionada será removida deste aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          setProject((current) => ({ ...current, layers: { ...current.layers, [id]: createLayer(id) } }));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  }, []);

  const activateSmartCutout = useCallback(async () => {
    const id = editingLayer;
    const uri = projectRef.current.layers[id].uri;
    if (id === 'background' || !uri || processing) return;
    setProcessing(true);
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Recorte inteligente', 'O isolamento de pessoas usa ML nativo e fica disponível no app instalado no Android ou iOS.');
        return;
      }
      const supported = await isNativeBackgroundRemovalSupported();
      if (!supported) {
        Alert.alert('Recorte indisponível', 'Este aparelho não oferece o modelo nativo necessário para isolar a pessoa.');
        return;
      }
      const transparentUri = await removeBackground(uri, { trim: false });
      updateLayer(id, { uri: transparentUri, enabled: true, backgroundRemoved: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Não foi possível isolar a pessoa', 'Tente novamente com uma foto em que o sujeito esteja mais nítido e separado do fundo.');
    } finally {
      setProcessing(false);
    }
  }, [editingLayer, processing, updateLayer]);

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
        const isCutoutLayer = id !== 'background';
        const optimized = await ImageManipulator.manipulateAsync(asset.uri, resize, {
          compress: isCutoutLayer ? 0.86 : 0.72,
          // JPEG removes alpha. Nearby layers stay PNG so transparent subjects
          // never acquire a black rectangle during composition.
          format: isCutoutLayer ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
        });
        updateLayer(id, { uri: optimized.uri, enabled: true, backgroundRemoved: false });
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
    Alert.alert('Começar de novo?', 'As camadas atuais serão removidas deste aparelho.', [
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
    if (Object.values(project.layers).filter((layer) => Boolean(layer.uri) && layer.enabled).length < 2) {
      Alert.alert('Adicione mais uma camada', 'Duas imagens já são suficientes para criar o efeito Parallax.');
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
    motionBaseline.current = null;
    filteredMotion.current = { x: 0, y: 0 };
    motionX.stopAnimation();
    motionY.stopAnimation();
    motionX.setValue(0);
    motionY.setValue(0);
    DeviceMotion.setUpdateInterval(16);
    const subscription = DeviceMotion.addListener((data) => {
      const rotation = data.rotation;
      if (!rotation) return;
      if (!motionBaseline.current) {
        motionBaseline.current = {
          beta: rotation.beta,
          gamma: rotation.gamma,
        };
        return;
      }
      const horizontalRotation = shortestAngleDelta(rotation.gamma, motionBaseline.current.gamma);
      const verticalRotation = shortestAngleDelta(rotation.beta, motionBaseline.current.beta);
      const horizontalDegrees = applyMotionDeadZone((horizontalRotation * 180) / Math.PI, 0.7);
      const verticalDegrees = applyMotionDeadZone((verticalRotation * 180) / Math.PI, 0.7);
      const intensity = projectRef.current.intensity;
      const intensityFactor = intensity / 60;
      const targetX = clamp(horizontalDegrees * 0.45 * intensityFactor, -18, 18);
      const targetY = clamp(verticalDegrees * 0.35 * intensityFactor, -12, 12);
      filteredMotion.current = {
        x: filteredMotion.current.x + (targetX - filteredMotion.current.x) * 0.28,
        y: filteredMotion.current.y + (targetY - filteredMotion.current.y) * 0.28,
      };
      motionX.setValue(filteredMotion.current.x);
      motionY.setValue(filteredMotion.current.y);
    });
    return () => {
      subscription.remove();
      motionBaseline.current = null;
      motionX.stopAnimation();
      motionY.stopAnimation();
    };
  }, [mode, motionX, motionY]);

  const edit = project.layers[editingLayer];
  const importedCount = Object.values(project.layers).filter((layer) => Boolean(layer.uri)).length;
  const readyCount = Object.values(project.layers).filter((layer) => Boolean(layer.uri) && layer.enabled).length;
  const canCompose = readyCount >= 2;
  const gestureLayerId = mode === 'edit' ? editingLayer : project.activeLayer;
  const getTranslationBounds = useCallback((scale: number) => {
    return {
      x: Math.max(80, CANVAS_WIDTH * 0.55 * scale),
      y: Math.max(100, CANVAS_HEIGHT * 0.55 * scale),
    };
  }, []);
  const canHandleCanvasGesture = useCallback(() => {
      const activeLayer = projectRef.current.layers[gestureLayerId];
      if (!activeLayer.uri || (mode === 'compose' && gestureLayerId === 'background')) return false;
      return true;
    }, [gestureLayerId, mode]);
  const canvasResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: canHandleCanvasGesture,
        onStartShouldSetPanResponderCapture: canHandleCanvasGesture,
        onMoveShouldSetPanResponder: canHandleCanvasGesture,
        onMoveShouldSetPanResponderCapture: canHandleCanvasGesture,
        onPanResponderGrant: (event) => {
          const layer = projectRef.current.layers[gestureLayerId];
          const touches = event.nativeEvent.touches;
          const isPinch = touches.length >= 2;
          const firstTouch = touches[0];
          const pageX = isPinch ? (touches[0].pageX + touches[1].pageX) / 2 : firstTouch?.pageX ?? event.nativeEvent.pageX;
          const pageY = isPinch ? (touches[0].pageY + touches[1].pageY) / 2 : firstTouch?.pageY ?? event.nativeEvent.pageY;
          const primaryLocalX = event.nativeEvent.locationX ?? firstTouch?.locationX ?? CANVAS_WIDTH / 2;
          const primaryLocalY = event.nativeEvent.locationY ?? firstTouch?.locationY ?? CANVAS_HEIGHT / 2;
          const focalX = isPinch ? primaryLocalX + (touches[1].pageX - touches[0].pageX) / 2 : primaryLocalX;
          const focalY = isPinch ? primaryLocalY + (touches[1].pageY - touches[0].pageY) / 2 : primaryLocalY;
          const distance = isPinch ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;
          gestureStart.current = { mode: isPinch ? 'pinch' : 'pan', x: layer.x, y: layer.y, scale: layer.scale, distance, focalX, focalY, pageX, pageY };
          Haptics.selectionAsync();
        },
        onPanResponderMove: (event) => {
          const touches = event.nativeEvent.touches;
          const activeLayer = gestureLayerId;
          if (touches.length >= 2) {
            const distance = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            if (gestureStart.current.mode !== 'pinch') {
              const layer = projectRef.current.layers[activeLayer];
              const pageX = (touches[0].pageX + touches[1].pageX) / 2;
              const pageY = (touches[0].pageY + touches[1].pageY) / 2;
              const focalX = gestureStart.current.focalX + pageX - gestureStart.current.pageX;
              const focalY = gestureStart.current.focalY + pageY - gestureStart.current.pageY;
              gestureStart.current = { mode: 'pinch', x: layer.x, y: layer.y, scale: layer.scale, distance, focalX, focalY, pageX, pageY };
              return;
            }
            if (!gestureStart.current.distance) return;
            const pageX = (touches[0].pageX + touches[1].pageX) / 2;
            const pageY = (touches[0].pageY + touches[1].pageY) / 2;
            const focalX = gestureStart.current.focalX + pageX - gestureStart.current.pageX;
            const focalY = gestureStart.current.focalY + pageY - gestureStart.current.pageY;
            const nextScale = clamp(
              gestureStart.current.scale * (distance / gestureStart.current.distance),
              MIN_GESTURE_SCALE,
              MAX_GESTURE_SCALE,
            );
            const scaleRatio = nextScale / gestureStart.current.scale;
            const bounds = getTranslationBounds(nextScale);
            const nextX =
              gestureStart.current.x +
              (focalX - gestureStart.current.focalX) +
              (gestureStart.current.focalX - CANVAS_WIDTH / 2 - gestureStart.current.x) * (1 - scaleRatio);
            const nextY =
              gestureStart.current.y +
              (focalY - gestureStart.current.focalY) +
              (gestureStart.current.focalY - CANVAS_HEIGHT / 2 - gestureStart.current.y) * (1 - scaleRatio);
            updateLayer(activeLayer, {
              scale: nextScale,
              x: clamp(nextX, -bounds.x, bounds.x),
              y: clamp(nextY, -bounds.y, bounds.y),
            });
          } else if (touches.length === 1) {
            if (gestureStart.current.mode === 'pinch') {
              const layer = projectRef.current.layers[activeLayer];
              gestureStart.current = {
                mode: 'pan',
                x: layer.x,
                y: layer.y,
                scale: layer.scale,
                distance: 0,
                focalX: 0,
                focalY: 0,
                pageX: touches[0].pageX,
                pageY: touches[0].pageY,
              };
              return;
            }
            if (gestureStart.current.mode !== 'pan') return;
            const bounds = getTranslationBounds(projectRef.current.layers[activeLayer].scale);
            updateLayer(activeLayer, {
              x: clamp(gestureStart.current.x + touches[0].pageX - gestureStart.current.pageX, -bounds.x, bounds.x),
              y: clamp(gestureStart.current.y + touches[0].pageY - gestureStart.current.pageY, -bounds.y, bounds.y),
            });
          }
        },
        onPanResponderRelease: () => {
          gestureStart.current = { ...gestureStart.current, mode: 'idle', distance: 0 };
        },
        onPanResponderTerminate: () => {
          gestureStart.current = { ...gestureStart.current, mode: 'idle', distance: 0 };
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [canHandleCanvasGesture, getTranslationBounds, gestureLayerId, updateLayer],
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
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Toque em uma camada e use os gestos diretamente na imagem para ajustar o enquadramento.</Text>
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
            {LAYER_IDS.filter((id) => id !== 'background').map((id) => (
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
        <Progress
          mode={mode}
          colors={colors}
          editingLayer={editingLayer}
          onPreviousLayer={() => setEditingLayer(editingLayer === 'foreground' ? 'middle' : 'background')}
          onNextLayer={() => {
            if (editingLayer === 'background') setEditingLayer('middle');
            else if (editingLayer === 'middle') setEditingLayer('foreground');
            else goToCompose();
          }}
          inHeader
        />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View
            {...canvasResponder.panHandlers}
            style={[styles.editPreview, { backgroundColor: colors.muted, borderColor: colors.border }]}
          >
            {edit.backgroundRemoved ? <TransparencyGrid colors={colors} /> : null}
            {edit.uri ? (
              <LayerImage
                uri={edit.uri}
                preserveAspectRatio={edit.id === 'background' ? 'xMidYMid slice' : 'xMidYMid meet'}
                style={[
                  styles.editImage,
                  {
                    transform: [
                      { translateX: edit.x },
                      { translateY: edit.y },
                      { scale: edit.scale * (1 + edit.crop / 180) },
                    ],
                  },
                ]}
              />
            ) : null}
            {!edit.uri ? (
              <Pressable
                testID="add-image-preview"
                accessibilityRole="button"
                accessibilityLabel="Adicionar uma imagem"
                onPress={() => pickLayer(editingLayer)}
                style={StyleSheet.absoluteFill}
              >
                <View pointerEvents="none" style={[styles.editOverlay, { backgroundColor: colors.background }]}>
                  <Ionicons name="image-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.editOverlayText, { color: colors.foreground }]}>Adicione uma imagem</Text>
                </View>
              </Pressable>
            ) : (
              <View pointerEvents="none" style={[styles.editOverlay, { backgroundColor: colors.background }]}>
                <Ionicons name={edit.backgroundRemoved ? 'cut' : 'checkmark-circle'} size={15} color={edit.backgroundRemoved ? colors.success : colors.mutedForeground} />
                <Text style={[styles.editOverlayText, { color: colors.foreground }]}>
                  {edit.backgroundRemoved ? 'Transparência visível · ML local' : 'Imagem original · enquadre antes de remover'}
                </Text>
              </View>
            )}
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
              {editingLayer !== 'background' ? (
                <View style={[styles.cropCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <View style={styles.cropCopy}>
                    <View style={[styles.cropIcon, { backgroundColor: colors.primary }]}>
                      <Ionicons name="crop-outline" size={18} color={colors.primaryForeground} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.controlLabel, { color: colors.foreground }]}>Recorte inteligente</Text>
                      <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>
                        {edit.backgroundRemoved ? 'Fundo removido no aparelho. Ajuste o enquadramento para refinar a composição.' : 'O app preserva a transparência e tenta separar o sujeito com ML local.'}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    testID="remover-fundo"
                    accessibilityRole="button"
                    accessibilityLabel={edit.backgroundRemoved ? 'Fundo transparente ativo' : 'Remover fundo e isolar pessoa'}
                    disabled={processing || edit.backgroundRemoved}
                    onPress={activateSmartCutout}
                    style={({ pressed }) => [
                      styles.removeBackgroundButton,
                      {
                        backgroundColor: edit.backgroundRemoved ? colors.success : colors.primary,
                        opacity: processing ? 0.6 : pressed ? 0.78 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={edit.backgroundRemoved ? 'checkmark-circle-outline' : processing ? 'sync-outline' : 'cut-outline'}
                      size={18}
                      color={edit.backgroundRemoved ? colors.primaryForeground : colors.primaryForeground}
                    />
                    <Text style={[styles.removeBackgroundText, { color: colors.primaryForeground }]}>
                      {edit.backgroundRemoved ? 'Fundo transparente ativo' : processing ? 'Separando pessoa…' : 'Remover fundo e isolar pessoa'}
                    </Text>
                  </Pressable>
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
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Header title="Parallax" subtitle="Wallpaper studio" colors={colors} onReset={importedCount > 0 ? resetProject : undefined} />
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
            <Text style={[styles.screenTitleSmall, { color: colors.foreground }]}>Monte sua cena</Text>
          </View>
          <Text style={[styles.layerCount, { color: colors.mutedForeground }]}>{readyCount}/3 ativas · 2 mín.</Text>
        </View>
        <View style={styles.layerList}>
          {LAYER_IDS.map((id, index) => {
            const layer = project.layers[id];
            return (
              <View
                key={id}
                style={[
                  styles.layerRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: layer.uri && layer.enabled ? colors.primary : colors.border,
                    opacity: layer.uri && !layer.enabled ? 0.58 : 1,
                  },
                ]}
              >
                <Pressable
                  testID={`slot-${id}`}
                  onPress={() => {
                    setEditingLayer(id);
                    if (layer.uri) setMode('edit');
                    else pickLayer(id);
                  }}
                  style={({ pressed }) => [styles.layerRowMain, pressed && styles.pressed]}
                >
                  <View style={[styles.layerThumbnail, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    {layer.uri ? <LayerImage uri={layer.uri} style={styles.thumbnailImage} preserveAspectRatio="xMidYMid slice" /> : <Ionicons name="add" size={20} color={colors.mutedForeground} />}
                  </View>
                  <View style={styles.layerRowCopy}>
                    <Text style={[styles.layerEyebrow, { color: colors.primary }]}>{layer.eyebrow}</Text>
                    <Text style={[styles.layerRowTitle, { color: colors.foreground }]}>{layer.label}</Text>
                    <Text style={[styles.layerRowHelper, { color: colors.mutedForeground }]}>
                      {layer.uri ? (layer.enabled ? 'Ativa · pronta para editar' : 'Desativada · não entra na cena') : layer.helper}
                    </Text>
                  </View>
                  {!layer.uri ? (
                    <View style={[styles.layerStatus, { backgroundColor: colors.secondary }]}>
                      <Ionicons name="arrow-up-outline" size={16} color={colors.foreground} />
                    </View>
                  ) : null}
                </Pressable>
                {layer.uri ? (
                  <View style={styles.layerActions}>
                    <Pressable
                      testID={`toggle-${id}`}
                      accessibilityRole="button"
                      accessibilityLabel={layer.enabled ? `Desativar camada ${layer.label}` : `Ativar camada ${layer.label}`}
                      onPress={() => toggleLayer(id)}
                      style={({ pressed }) => [
                        styles.layerAction,
                        {
                          backgroundColor: layer.enabled ? colors.primary : colors.secondary,
                          borderColor: layer.enabled ? colors.primary : colors.border,
                        },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name={layer.enabled ? 'checkmark' : 'ellipse-outline'} size={17} color={layer.enabled ? colors.primaryForeground : colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      testID={`remove-${id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Remover camada ${layer.label}`}
                      onPress={() => removeLayer(id)}
                      style={({ pressed }) => [styles.layerAction, { backgroundColor: colors.secondary, borderColor: colors.border }, pressed && styles.pressed]}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.accent} />
                    </Pressable>
                  </View>
                ) : null}
                {index < 2 ? <View style={[styles.layerConnector, { backgroundColor: colors.border }]} /> : null}
              </View>
            );
          })}
        </View>
        <View style={[styles.tipCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Ionicons name="flash-outline" size={18} color={colors.accent} />
          <Text style={[styles.bodyTextSmall, { color: colors.mutedForeground }]}>Dica: use fotos com elementos em distâncias diferentes para um efeito mais cinematográfico.</Text>
        </View>
        <PrimaryButton title={canCompose ? 'Continuar para composição' : 'Adicionar primeira camada'} onPress={canCompose ? goToCompose : () => pickLayer('background')} colors={colors} icon="arrow-forward" />
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
  progressHeader: { marginHorizontal: 20, marginBottom: 14 },
  progressSteps: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 4 },
  progressStep: { alignItems: 'center', gap: 6 },
  progressDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  progressLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  progressLine: { flex: 1, height: 1, marginHorizontal: 8, marginBottom: 16 },
  progressArrow: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  progressArrowDisabled: { opacity: 0.35 },
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
  layerRowMain: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center' },
  layerThumbnail: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%' },
  layerRowCopy: { flex: 1, paddingHorizontal: 12 },
  layerEyebrow: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  layerRowTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  layerRowHelper: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 3 },
  layerStatus: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  layerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  layerAction: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  layerConnector: { position: 'absolute', width: 1, height: 10, left: 41, bottom: -10, zIndex: 3 },
  tipCard: { borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 16 },
  primaryButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryButtonText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 14 },
  savedText: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter_500Medium', paddingTop: 12 },
  editPreview: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, alignSelf: 'center', borderRadius: 22, borderWidth: 1, overflow: 'hidden', marginBottom: 20 },
  transparencyGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  transparencyCell: { width: '12.5%', height: '12.5%' },
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
  removeBackgroundButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  removeBackgroundText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  emptyEdit: { gap: 18, paddingVertical: 8 },
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
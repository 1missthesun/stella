import {
  type ReactNode,
  type Ref,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import {
  Animated,
  LayoutAnimation,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "../Text";
import { useT } from "../../i18n";
import {
  attachmentPreviewUri,
  type ComposerAttachment,
} from "../../lib/chat-attachments";
import { useChatDraft, type ChatDraftStore } from "../../lib/chat-draft-store";
import { resolveComposerExpanded } from "../../lib/composer-model-layout";
import type { DictationStatus } from "../../lib/dictation";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { type Colors } from "../../theme/colors";
import { fadeHex } from "../../theme/oklch";
import { fonts } from "../../theme/fonts";
import type { ComposerPastedText, ComposerQuote } from "../../types";
import { shouldAttachPastedText } from "@stella/contracts/pasted-text";
import { DictationRecordingBar } from "../DictationRecordingBar";
import { GlassSurface } from "../glass";
import { Icon } from "../Icon";
import { useServerFeatures } from "../../lib/server-features";
import { setTopBarCovered, topBarCover } from "../../lib/top-bar-cover";
import { AskSlotContext, type AskRoom, type AskSlot } from "./ask-slot";
import {
  AttachmentFailedMark,
  AttachmentTileRow,
  FileTile,
  PastedTextTile,
  ImageTile,
  VideoPlayBadge,
} from "./AttachmentTiles";
import { fileDisplayName } from "@stella/contracts/file-display-name";

export const CHAT_HORIZONTAL_INSET = 12;

const EXPAND_THRESHOLD = 30;
const COMPOSER_INPUT_MAX_HEIGHT = 200;
const ASK_SLOT_CHROME = 20;
const ASK_MIN_HEIGHT = 160;
const ASK_UNBOUNDED = 100_000;
/** How far an ask card reaches into the top bar before the bar is gone. */
const TOP_BAR_COVER_RAMP = 16;
export const LAYOUT_SPRING = {
  duration: 350,
  update: { type: LayoutAnimation.Types.spring, springDamping: 1 },
  create: {
    type: LayoutAnimation.Types.spring,
    springDamping: 1,
    property: LayoutAnimation.Properties.opacity,
  },
  delete: {
    type: LayoutAnimation.Types.spring,
    springDamping: 1,
    property: LayoutAnimation.Properties.opacity,
  },
};

export const isDraftEmpty = (draft: string) => draft.length === 0;
export const draftHasText = (draft: string) => draft.trim().length > 0;

type ComposerStyles = ReturnType<typeof makeComposerStyles>;

export type ComposerModelPickerConfig = {
  pinned: boolean;
  label: string;
  loading?: boolean;
  effortLabel: string;
  effortOptions: readonly {
    id: string;
    label: string;
    selected: boolean;
  }[];
  recentModels: readonly {
    id: string;
    label: string;
    selected: boolean;
  }[];
  onOpen: () => void;
  onSelectEffort: (id: string) => void;
  onSelectModel: (id: string) => void;
};

type InputHeightBounds = { min: number; max: number };

/** The text one edit inserted, and the result without it. */
const insertedText = (
  previous: string,
  next: string,
): { text: string; without: string } | null => {
  if (next.length <= previous.length) return null;
  const shorter = previous.length;
  let start = 0;
  while (start < shorter && previous[start] === next[start]) start += 1;
  let end = 0;
  while (
    end < shorter - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    text: next.slice(start, next.length - end),
    without: next.slice(0, start) + next.slice(next.length - end),
  };
};

const mirrorTextOf = (draft: string) =>
  draft.length === 0 || draft.endsWith("\n") ? `${draft} ` : draft;

/**
 * iOS Fabric sizes a TextInput from the text its native view last reported,
 * which only changes when the user types; text set from JS (a dictation
 * result, a cleared or restored draft) is measured as the old text. A hidden
 * copy of the draft with the same text style is measured instead and gives
 * the input its height.
 */
function ComposerTextInput({
  draftStore,
  ref,
  style,
  containerStyle,
  heightBounds,
  onContentHeight,
  onLongPaste,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText" | "style"> & {
  draftStore: ChatDraftStore;
  ref?: Ref<TextInput>;
  style: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  heightBounds: InputHeightBounds;
  onContentHeight?: (height: number) => void;
  /** A paste long enough to send as "Pasted text" instead of composer text. */
  onLongPaste?: (text: string) => void;
}) {
  const value = useChatDraft(draftStore);
  const handleChangeText = useCallback(
    (next: string) => {
      const inserted = onLongPaste ? insertedText(draftStore.get(), next) : null;
      if (inserted && onLongPaste && shouldAttachPastedText(inserted.text)) {
        draftStore.set(inserted.without);
        onLongPaste(inserted.text);
        return;
      }
      draftStore.set(next);
    },
    [draftStore, onLongPaste],
  );
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const onContentHeightRef = useRef(onContentHeight);
  onContentHeightRef.current = onContentHeight;
  const handleMirrorLayout = useCallback((e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setContentHeight(height);
    onContentHeightRef.current?.(height);
  }, []);
  const mirrorStyle = useMemo(() => {
    const {
      height: _height,
      minHeight: _minHeight,
      maxHeight: _maxHeight,
      flex: _flex,
      ...text
    } = StyleSheet.flatten(style) ?? {};
    return [text, composerInputMirror];
  }, [style]);
  const sizedStyle =
    Platform.OS === "ios" && contentHeight !== null
      ? [
          style,
          {
            height: Math.min(
              heightBounds.max,
              Math.max(heightBounds.min, contentHeight),
            ),
          },
        ]
      : style;
  return (
    <View style={containerStyle}>
      {/* Scales with the input, which has no Dynamic Type cap of its own
          (0 = none), so the measured height matches the input's text. */}
      <Text
        style={mirrorStyle}
        allowFontScaling={props.allowFontScaling}
        maxFontSizeMultiplier={props.maxFontSizeMultiplier ?? 0}
        onLayout={handleMirrorLayout}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {mirrorTextOf(value)}
      </Text>
      <TextInput
        ref={ref}
        {...props}
        style={sizedStyle}
        value={value}
        onChangeText={handleChangeText}
      />
    </View>
  );
}

const composerInputMirror: TextStyle = {
  left: 0,
  opacity: 0,
  position: "absolute",
  right: 0,
  top: 0,
};

const PILL_INPUT_HEIGHT: InputHeightBounds = { min: 0, max: 32 };
const EXPANDED_INPUT_HEIGHT: InputHeightBounds = {
  min: 46,
  max: COMPOSER_INPUT_MAX_HEIGHT,
};
const EXPANDED_EMPTY_INPUT_HEIGHT: InputHeightBounds = { min: 46, max: 46 };

function AnimatedSubmitButton({
  canSubmit,
  onPress,
  styles,
  colors,
  accessibilityLabel,
}: {
  canSubmit: boolean;
  onPress: () => void;
  styles: ComposerStyles;
  colors: Colors;
  accessibilityLabel: string;
}) {
  const opacity = useRef(new Animated.Value(canSubmit ? 1 : 0.4)).current;
  const scale = useRef(new Animated.Value(canSubmit ? 1 : 0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, {
        toValue: canSubmit ? 1 : 0.4,
        damping: 18,
        stiffness: 260,
        mass: 0.6,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: canSubmit ? 1 : 0.92,
        damping: 18,
        stiffness: 260,
        mass: 0.6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [canSubmit, opacity, scale]);

  const animatedStyle = useMemo(
    () => ({ opacity, transform: [{ scale }] }),
    [opacity, scale],
  );

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        accessibilityLabel={accessibilityLabel}
        style={styles.submitButton}
        hitSlop={4}
      >
        <Icon
          name="arrow-up"
          size={15}
          color={colors.accentForeground}
          weight="heavy"
        />
      </Pressable>
    </Animated.View>
  );
}

type MicHitArea = { top: number; bottom: number; left: number; right: number };

// The mic's tap area reaches past its 32pt circle into the space around it,
// up to halfway to a neighbouring button and never into the text itself.
// It is real layout (padding offset by negative margin), not hitSlop:
// Android only routes touches outside a parent to children that overflow it.
const PILL_MIC_VERTICAL_REACH = 12;
const PILL_MIC_LEADING_REACH = 12;
const PILL_EDGE_REACH = 8;
const CLUSTER_GAP_SHARE = 3;
const TOOLBAR_MIC_TOP_REACH = 4;
const TOOLBAR_MIC_BOTTOM_REACH = 6;
const TOOLBAR_GAP_SHARE = 4;
const OPEN_SPACE_REACH = 16;

function micHitAreaStyle({ top, bottom, left, right }: MicHitArea) {
  return {
    marginBottom: -bottom,
    marginLeft: -left,
    marginRight: -right,
    marginTop: -top,
    paddingBottom: bottom,
    paddingLeft: left,
    paddingRight: right,
    paddingTop: top,
  };
}

export const Composer = memo(function Composer({
  colors,
  inputRef,
  draftStore,
  enabled,
  placeholder,
  intervention,
  compact = false,
  askCollapsed = false,
  onExpandAsk,
  askRoom,
  bottomPad,
  draftEmpty,
  hasText,
  canSubmit,
  onSubmit,
  onInputFocus,
  onPressPlus,
  dictationStatus,
  onToggleVoice,
  onCancelDictation,
  onConfirmDictation,
  onStopAndSendVoice,
  showRealtimeVoice,
  onOpenRealtimeVoice,
  modelPicker,
  modelPickerAnchorRef,
  onPressModelPicker,
  quotes,
  onRemoveQuote,
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
  pastedTexts,
  onAddPastedText,
  onRemovePastedText,
}: {
  colors: Colors;
  inputRef: RefObject<TextInput | null>;
  draftStore: ChatDraftStore;
  enabled: boolean;
  placeholder: string;
  intervention?: ReactNode;
  compact?: boolean;
  askCollapsed?: boolean;
  onExpandAsk?: () => void;
  askRoom?: AskRoom;
  bottomPad: number;
  draftEmpty: boolean;
  hasText: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onInputFocus: () => void;
  onPressPlus: () => void;
  dictationStatus: DictationStatus;
  onToggleVoice: () => Promise<void>;
  onCancelDictation: () => void;
  onConfirmDictation: () => void;
  onStopAndSendVoice: () => void;
  showRealtimeVoice: boolean;
  onOpenRealtimeVoice: () => Promise<void>;
  modelPicker?: ComposerModelPickerConfig;
  modelPickerAnchorRef: RefObject<View | null>;
  onPressModelPicker: () => void;
  quotes?: ComposerQuote[];
  onRemoveQuote?: (id: string) => void;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  pastedTexts?: ComposerPastedText[];
  onAddPastedText?: (text: string) => void;
  onRemovePastedText?: (id: string) => void;
}) {
  const serverFeatures = useServerFeatures();
  const styles = useMemo(() => makeComposerStyles(colors), [colors]);
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const isListening = dictationStatus === "recording";
  const isTranscribing = dictationStatus === "transcribing";

  useEffect(() => {
    if (expanded && draftEmpty) {
      LayoutAnimation.configureNext(LAYOUT_SPRING);
      setExpanded(false);
    }
  }, [draftEmpty, expanded]);

  // Expansion is one-way while the user is typing: the pill and expanded
  // shapes give the text different widths, so a 2-line pill can re-flow to
  // 1 line in expanded shape — flipping back to pill would re-wrap and
  // oscillate forever. Collapse happens only when the parent clears the
  // draft (see the `useEffect` above) or via dedicated dictation handlers.
  const growForPillHeight = useCallback(
    (height: number) => {
      if (expanded || draftStore.get().length === 0) return;
      if (height > EXPAND_THRESHOLD) {
        LayoutAnimation.configureNext(LAYOUT_SPRING);
        setExpanded(true);
      }
    },
    [expanded, draftStore],
  );

  const dictationCompact = compact && isListening;
  const dictationBelow = !compact && isListening;
  const isExpandedComposed =
    !compact &&
    resolveComposerExpanded({
      expanded,
      dictationBelow,
      modelPickerPinned: Boolean(modelPicker?.pinned),
      hasAttachments:
        (attachments?.length ?? 0) > 0 || (pastedTexts?.length ?? 0) > 0,
      hasQuotes: (quotes?.length ?? 0) > 0,
    });

  const plusButton =
    enabled && !isListening ? (
      <View collapsable={false}>
        <Pressable
          style={styles.addButton}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Open add menu"
          onPress={onPressPlus}
        >
          <Icon
            name="plus"
            size={17}
            color={colors.textMuted}
            weight="semibold"
          />
        </Pressable>
      </View>
    ) : null;

  const renderMicButton = (hitArea: MicHitArea) =>
    serverFeatures.dictation ? (
      <Pressable
        onPress={() => void onToggleVoice()}
        accessibilityRole="button"
        accessibilityState={{ disabled: isTranscribing }}
        accessibilityLabel={
          isListening ? "Stop voice input" : "Start voice input"
        }
        disabled={isTranscribing}
        style={micHitAreaStyle(hitArea)}
      >
        <View style={[styles.micButton, isListening && styles.micButtonActive]}>
          <Icon
            name={isListening ? "mic-off" : "mic"}
            size={20}
            color={isListening ? colors.accentForeground : colors.textMuted}
            filled={isListening}
          />
        </View>
      </Pressable>
    ) : null;
  const pillMicButton = renderMicButton({
    top: PILL_MIC_VERTICAL_REACH,
    bottom: PILL_MIC_VERTICAL_REACH,
    left: PILL_MIC_LEADING_REACH,
    right: showRealtimeVoice ? CLUSTER_GAP_SHARE : PILL_EDGE_REACH,
  });
  const toolbarMicButton = renderMicButton({
    top: TOOLBAR_MIC_TOP_REACH,
    bottom: TOOLBAR_MIC_BOTTOM_REACH,
    left: modelPicker?.pinned ? TOOLBAR_GAP_SHARE : OPEN_SPACE_REACH,
    right: TOOLBAR_GAP_SHARE,
  });

  const realtimeVoiceButton = showRealtimeVoice ? (
    <Pressable
      onPress={() => void onOpenRealtimeVoice()}
      accessibilityRole="button"
      accessibilityLabel="Start realtime voice conversation"
      style={({ pressed }) => [
        styles.realtimeVoiceButton,
        pressed && styles.realtimeVoiceButtonPressed,
      ]}
      hitSlop={4}
    >
      <Icon name="waveform" size={19} color={colors.text} weight="semibold" />
    </Pressable>
  ) : null;

  const [shellHeight, setShellHeight] = useState(0);
  const onShellLayout = useCallback((e: LayoutChangeEvent) => {
    setShellHeight(Math.round(e.nativeEvent.layout.height));
  }, []);
  const askNaturalHeight = useSharedValue(0);
  const askBase =
    askRoom === undefined || shellHeight === 0
      ? null
      : askRoom.belowTopBar - shellHeight - bottomPad - ASK_SLOT_CHROME;
  const askTopBar = askRoom?.topBar ?? 0;
  const keyboardLift = askRoom?.keyboardLift;
  const keyboardOpenLift = askRoom?.keyboardOpenLift;
  const askBelowTopBar = useDerivedValue(() => {
    if (askBase === null) return ASK_UNBOUNDED;
    return askBase - (keyboardLift?.value ?? 0);
  });
  const askMaxHeight = useDerivedValue(() => {
    const below = askBelowTopBar.value;
    if (below === ASK_UNBOUNDED) return below;
    const lift = keyboardLift?.value ?? 0;
    const openLift = keyboardOpenLift?.value ?? 0;
    const opened = openLift > 0 ? Math.min(1, lift / openLift) : 0;
    return Math.max(ASK_MIN_HEIGHT, below + askTopBar * opened);
  });
  const askShowing = compact;
  useAnimatedReaction(
    () => {
      if (!askShowing || askNaturalHeight.value <= 0) return 0;
      const below = askBelowTopBar.value;
      if (below === ASK_UNBOUNDED) return 0;
      const height = Math.min(askNaturalHeight.value, askMaxHeight.value);
      return Math.min(1, Math.max(0, (height - below) / TOP_BAR_COVER_RAMP));
    },
    (cover, previous) => {
      topBarCover.value = cover;
      const covered = cover > 0.5;
      if (previous === null || covered !== previous > 0.5) {
        runOnJS(setTopBarCovered)(covered);
      }
    },
    [askShowing],
  );
  useEffect(
    () => () => {
      topBarCover.value = 0;
      setTopBarCovered(false);
    },
    [],
  );
  const askSlot = useMemo<AskSlot>(
    () => ({
      collapsed: askCollapsed,
      maxHeight: askRoom === undefined ? null : askMaxHeight,
      naturalHeight: askNaturalHeight,
      expand: onExpandAsk ?? (() => {}),
    }),
    [askCollapsed, askMaxHeight, askNaturalHeight, askRoom, onExpandAsk],
  );

  const showAttachmentStrip =
    !compact &&
    ((attachments?.length ?? 0) > 0 || (pastedTexts?.length ?? 0) > 0);
  const quoteChips = quotes ?? [];
  const showQuoteStrip = !compact && quoteChips.length > 0;

  return (
    <View style={[styles.composerWrap, { paddingBottom: bottomPad }]}>
      <AskSlotContext.Provider value={askSlot}>
        {intervention}
      </AskSlotContext.Provider>
      <View
        style={styles.composerShellSlot}
        pointerEvents="box-none"
        onLayout={onShellLayout}
      >
      <Pressable
        accessible={false}
        style={styles.composerFocusTarget}
        disabled={!enabled || isListening}
        onPress={() => inputRef.current?.focus()}
      >
        <GlassSurface
          glass="regular"
          interactive
          tintColor={fadeHex(colors.surface, 0.5)}
          radius={isExpandedComposed ? 20 : 999}
          fallbackColor={colors.surface}
          style={styles.shell}
        >
          {showQuoteStrip ? (
            <View style={styles.composerQuoteStrip}>
              {quoteChips.map((quote) => (
                <View key={quote.id} style={styles.composerQuote}>
                  <Icon
                    name="reply"
                    size={14}
                    color={colors.textMuted}
                    weight="regular"
                  />
                  <Text
                    style={styles.composerQuoteText}
                    numberOfLines={2}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                  >
                    {quote.text}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [
                      styles.composerQuoteRemove,
                      pressed && styles.composerQuoteRemovePressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Remove quoted text"
                    onPress={() => onRemoveQuote?.(quote.id)}
                    hitSlop={10}
                  >
                    <Icon
                      name="x"
                      size={10}
                      color={colors.textMuted}
                      weight="bold"
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {showAttachmentStrip ? (
            <AttachmentTileRow
              align="start"
              colors={colors}
              style={styles.attachmentStrip}
              items={(attachments ?? []).map((attachment) => ({
                key: attachment.id,
                node: (
                <View key={attachment.id} style={styles.attachmentThumb}>
                  {attachmentPreviewUri(attachment) ? (
                    <ImageTile
                      uri={attachmentPreviewUri(attachment)!}
                      name={attachment.name}
                      colors={colors}
                    />
                  ) : (
                    <FileTile name={fileDisplayName(attachment.name)} colors={colors} />
                  )}
                  {attachment.video ? <VideoPlayBadge /> : null}
                  {attachment.failed ? (
                    <AttachmentFailedMark
                      colors={colors}
                      label={t("chat.attachments.retryUpload")}
                      onPress={() => onRetryAttachment?.(attachment.id)}
                    />
                  ) : null}
                  <Pressable
                    style={styles.attachmentRemove}
                    accessibilityLabel={t("chat.attachments.remove")}
                    onPress={() => onRemoveAttachment?.(attachment.id)}
                    hitSlop={4}
                  >
                    <Icon
                      name="x"
                      size={12}
                      color="#ffffff"
                      weight="bold"
                    />
                  </Pressable>
                </View>
                ),
              })).concat((pastedTexts ?? []).map((pasted) => ({
                key: pasted.id,
                node: (
                <View key={pasted.id} style={styles.attachmentThumb}>
                  <PastedTextTile text={pasted.text} colors={colors} />
                  <Pressable
                    style={styles.attachmentRemove}
                    accessibilityLabel={t("app.chat.contextChips.removePastedText")}
                    onPress={() => onRemovePastedText?.(pasted.id)}
                    hitSlop={4}
                  >
                    <Icon
                      name="x"
                      size={12}
                      color="#ffffff"
                      weight="bold"
                    />
                  </Pressable>
                </View>
                ),
              })))}
            />
          ) : null}
          {dictationCompact ? (
            <View style={styles.dictationCompact}>
              <DictationRecordingBar
                onCancel={onCancelDictation}
                onConfirm={onConfirmDictation}
                onSend={onStopAndSendVoice}
              />
            </View>
          ) : (
            <View>
              <View
                style={
                  isExpandedComposed
                    ? styles.expandedInputBlock
                    : styles.formPill
                }
              >
                {isExpandedComposed ? null : plusButton}
                <ComposerTextInput
                  ref={inputRef}
                  draftStore={draftStore}
                  multiline
                  scrollEnabled={isExpandedComposed || compact}
                  containerStyle={
                    isExpandedComposed ? undefined : styles.inputPillSlot
                  }
                  heightBounds={
                    isExpandedComposed
                      ? draftEmpty
                        ? EXPANDED_EMPTY_INPUT_HEIGHT
                        : EXPANDED_INPUT_HEIGHT
                      : PILL_INPUT_HEIGHT
                  }
                  onContentHeight={
                    isExpandedComposed ? undefined : growForPillHeight
                  }
                  onFocus={onInputFocus}
                  onLongPaste={onAddPastedText}
                  blurOnSubmit={false}
                  placeholder={
                    isExpandedComposed
                      ? placeholder
                      : isTranscribing
                        ? "Transcribing\u2026"
                        : placeholder
                  }
                  placeholderTextColor={fadeHex(colors.textMuted, 0.35)}
                  selectionColor={colors.accent}
                  underlineColorAndroid="transparent"
                  style={
                    isExpandedComposed
                      ? [
                          styles.inputExpanded,
                          draftEmpty && styles.inputExpandedEmpty,
                        ]
                      : styles.inputPill
                  }
                  editable={enabled}
                />
                {isExpandedComposed ? null : canSubmit ? (
                  <AnimatedSubmitButton
                    canSubmit={canSubmit}
                    onPress={onSubmit}
                    styles={styles}
                    colors={colors}
                    accessibilityLabel="Send message"
                  />
                ) : (
                  <View style={styles.pillTrailingCluster}>
                    {pillMicButton}
                    {realtimeVoiceButton}
                  </View>
                )}
              </View>
              {isExpandedComposed && !dictationBelow ? (
                <View style={styles.toolbar}>
                  <View style={styles.toolbarLeft}>{plusButton}</View>
                  <View style={styles.toolbarRight}>
                    {modelPicker?.pinned ? (
                      <View ref={modelPickerAnchorRef} collapsable={false}>
                        <Pressable
                          onPress={onPressModelPicker}
                          disabled={modelPicker.loading}
                          accessibilityRole="button"
                          accessibilityLabel={t(
                            "app.chat.miniModelPicker.triggerLabel",
                            { model: modelPicker.label },
                          )}
                          style={({ pressed }) => [
                            styles.miniModelPickerTrigger,
                            pressed && styles.miniModelPickerTriggerPressed,
                          ]}
                        >
                          <Text
                            style={styles.miniModelPickerLabel}
                            numberOfLines={1}
                          >
                            {modelPicker.loading
                              ? "Loading…"
                              : modelPicker.label}
                          </Text>
                          <Icon
                            name="chevron-down"
                            size={13}
                            color={colors.textMuted}
                          />
                        </Pressable>
                      </View>
                    ) : null}
                    {toolbarMicButton}
                    {realtimeVoiceButton}
                    <AnimatedSubmitButton
                      canSubmit={canSubmit}
                      onPress={onSubmit}
                      styles={styles}
                      colors={colors}
                      accessibilityLabel="Send message"
                    />
                  </View>
                </View>
              ) : null}
              {dictationBelow ? (
                <View style={styles.dictationRow}>
                  <DictationRecordingBar
                    onCancel={onCancelDictation}
                    onConfirm={onConfirmDictation}
                    onSend={onStopAndSendVoice}
                  />
                </View>
              ) : null}
            </View>
          )}
        </GlassSurface>
      </Pressable>
      </View>
    </View>
  );
});

const makeComposerStyles = (colors: Colors) =>
  StyleSheet.create({
    composerWrap: {
      alignItems: "center",
      flexShrink: 0,
      gap: 8,
      paddingBottom: 6,
      paddingHorizontal: CHAT_HORIZONTAL_INSET,
      paddingTop: 12,
    },
    attachmentStrip: {
      paddingBottom: 2,
      paddingHorizontal: 12,
      paddingTop: 12,
    },
    composerQuoteStrip: {
      gap: 6,
      paddingHorizontal: 10,
      paddingTop: 10,
    },
    composerQuote: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.textMuted, 0.1),
      borderCurve: "continuous",
      borderRadius: 12,
      flexDirection: "row",
      gap: 10,
      paddingLeft: 8,
      paddingRight: 8,
      paddingVertical: 8,
    },
    composerQuoteText: {
      color: colors.textMuted,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      letterSpacing: -0.15,
      lineHeight: 19,
    },
    composerQuoteRemove: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.textMuted, 0.16),
      borderRadius: 999,
      height: 20,
      justifyContent: "center",
      width: 20,
    },
    composerQuoteRemovePressed: {
      backgroundColor: fadeHex(colors.textMuted, 0.28),
    },
    attachmentThumb: {
      borderCurve: "continuous",
      borderRadius: 12,
      height: 64,
      overflow: "hidden",
      position: "relative",
    },
    attachmentRemove: {
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.55)",
      borderRadius: 10,
      height: 20,
      justifyContent: "center",
      position: "absolute",
      right: 3,
      top: 3,
      width: 20,
    },
    shell: {
      borderColor: colors.panelSurfaceBorder,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
      width: "100%",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 8,
    },
    composerFocusTarget: { width: "100%" },
    composerShellSlot: { alignSelf: "stretch" },
    formPill: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 56,
      paddingHorizontal: 8,
      paddingVertical: 11,
    },
    expandedInputBlock: { flexDirection: "column" },
    inputPillSlot: { flex: 1 },
    inputPill: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      letterSpacing: -0.2,
      lineHeight: 22,
      maxHeight: 32,
      paddingHorizontal: 4,
      paddingVertical: 0,
      ...(Platform.OS === "android"
        ? { textAlignVertical: "center" as const }
        : {}),
    },
    inputExpanded: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      letterSpacing: -0.2,
      lineHeight: 24,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      minHeight: 46,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 2,
    },
    // A pinned model picker keeps the same scrollable UITextView expanded
    // after send. Its old intrinsic content height can survive clearing value;
    // an empty draft has a known resting height, independent of that cache.
    inputExpandedEmpty: { height: 46 },
    toolbar: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: 6,
      paddingHorizontal: 8,
      paddingTop: 2,
    },
    toolbarLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
    toolbarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    miniModelPickerTrigger: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      height: 30,
      maxWidth: 154,
      paddingHorizontal: 10,
    },
    miniModelPickerTriggerPressed: {
      opacity: 0.55,
    },
    miniModelPickerLabel: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      letterSpacing: -0.15,
    },
    pillTrailingCluster: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    dictationRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: fadeHex(colors.border, 0.5),
    },
    dictationCompact: {
      justifyContent: "center",
      minHeight: 56,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    addButton: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.text, 0.06),
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    submitButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    micButton: {
      alignItems: "center",
      backgroundColor: "transparent",
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    micButtonActive: { backgroundColor: colors.accent },
    realtimeVoiceButton: {
      alignItems: "center",
      backgroundColor: "transparent",
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    realtimeVoiceButtonPressed: {
      opacity: 0.55,
      transform: [{ scale: 0.96 }],
    },
  } as const);

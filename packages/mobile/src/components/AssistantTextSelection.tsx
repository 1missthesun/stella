import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { notifySuccess, tapLight } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { fonts } from "../theme/fonts";
import type { Colors } from "../theme/colors";

export function AssistantTextSelection({
  text,
  colors,
  onAskStella,
  onDismiss,
}: {
  text: string;
  colors: Colors;
  onAskStella?: (selected: string) => void;
  onDismiss: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selection, setSelection] = useState({ start: 0, end: text.length });
  const selectedText = () => {
    const slice = text.slice(selection.start, selection.end);
    return slice.length > 0 ? slice : text;
  };

  const handleSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    setSelection(e.nativeEvent.selection);
  };

  const handleCopy = () => {
    void Clipboard.setStringAsync(selectedText()).then((ok) => {
      if (ok) notifySuccess();
    });
    onDismiss();
  };

  const handleAsk = () => {
    tapLight();
    onAskStella?.(selectedText());
    onDismiss();
  };

  return (
    <View>
      <View style={styles.toolbar}>
        {onAskStella ? (
          <>
            <ToolbarButton
              label="Ask Stella"
              onPress={handleAsk}
              styles={styles}
            />
            <View style={styles.divider} />
          </>
        ) : null}
        <ToolbarButton label="Copy" onPress={handleCopy} styles={styles} />
      </View>
      <TextInput
        value={text}
        // Read-only: never mutate the reply. `editable` is required for
        // selection handles on iOS, so edits are neutralised by the fixed
        // `value` + no-op `onChangeText`, and the keyboard is suppressed.
        editable
        onChangeText={() => {}}
        showSoftInputOnFocus={false}
        caretHidden
        contextMenuHidden
        multiline
        scrollEnabled={false}
        autoFocus
        selection={selection}
        onSelectionChange={handleSelectionChange}
        style={styles.body}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        accessibilityLabel="Assistant message, selecting text"
      />
    </View>
  );
}

function ToolbarButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text
        style={styles.buttonLabel}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    toolbar: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.panel,
      marginBottom: 8,
      overflow: "hidden",
    },
    button: {
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    buttonPressed: {
      backgroundColor: colors.muted,
    },
    buttonLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      letterSpacing: -0.1,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: colors.border,
    },
    body: {
      margin: 0,
      padding: 0,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      lineHeight: 24,
    },
  });

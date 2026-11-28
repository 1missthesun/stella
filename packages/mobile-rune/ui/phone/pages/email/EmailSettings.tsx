import { useCallback, useState, type ReactNode } from "react";
import type { EmailPageState, EmailRuleKind } from "@stella/contracts/backend/email";
import { backendClient } from "@/platform/backend/backend-client";
import { useLocale, useT } from "@/shared/i18n";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { phoneSheet } from "../../ask";
import { glyph } from "../../icons";
import { GUTTER } from "../../rn";
import { Btn, formatWhen, HAIR, T, tapLight, useEmailColors } from "./kit";

const RULE_KIND_LABEL_KEY: Record<EmailRuleKind, string> = {
  wake: "email.workspace.rules.wake",
  act: "email.workspace.rules.act",
  ignore: "email.workspace.rules.ignore",
};

const TOP = 4 + 6;

function Group({ title, children }: { title: string; children: ReactNode }) {
  const c = useEmailColors();
  return (
    <col mt={24}>
      <text role="heading" {...T.sectionHeading} color={c.textMuted}>
        {title}
      </text>
      {children}
    </col>
  );
}

function HairlineList({ children }: { children: ReactNode }) {
  const c = useEmailColors();
  return (
    <col role="list" mt={8} borderSides={[HAIR, 0, 0, 0]} border={c.borderWeak}>
      {children}
    </col>
  );
}

function SettingsRow({ children }: { children: ReactNode }) {
  const c = useEmailColors();
  return (
    <row role="listitem" align="center" justify="between" gap={14} py={12} borderSides={[0, 0, HAIR, 0]} border={c.borderWeak}>
      {children}
    </row>
  );
}

function RowCopy({ main, sub }: { main: string; sub: string }) {
  const c = useEmailColors();
  return (
    <col grow={1} minW={0} gap={2}>
      <text {...T.settingsRowMain} color={c.textStrong}>
        {main}
      </text>
      <text {...T.settingsRowSub} color={c.textMuted}>
        {sub}
      </text>
    </col>
  );
}

/** NativeEmailView's settings page: your rules, the inboxes read, and turning email off. */
export function EmailSettings({ state, bottom, onBack }: { state: EmailPageState; bottom: number; onBack: () => void }) {
  const c = useEmailColors();
  const t = useT();
  const locale = useLocale();
  const [removingRuleId, setRemovingRuleId] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  const removeRule = useCallback(async (ruleId: string) => {
    tapLight();
    setRemovingRuleId(ruleId);
    try {
      await backendClient.call("email.tool", { action: "rules", op: "remove", rule: ruleId });
    } catch {
    } finally {
      setRemovingRuleId((current) => (current === ruleId ? null : current));
    }
  }, []);

  const confirmTurnOff = useCallback(async () => {
    tapLight();
    const picked = await phoneSheet({
      alert: true,
      title: t("email.workspace.off.confirm"),
      message: t("email.workspace.off.body"),
      actions: [{ id: "off", label: t("email.section.turnOff") }],
      destructive: "off",
      cancel: t("common.cancel"),
    });
    if (picked !== "off") return;
    setTurningOff(true);
    void backendClient
      .call("email.setEnabled", { enabled: false })
      .catch(() => {})
      .finally(() => setTurningOff(false));
  }, [t]);

  return (
    <col id="phone-email-settings" grow={1} minH={0} scrollY px={GUTTER} pt={TOP} pb={bottom + 32}>
      <row align="center" gap={12} pb={14} borderSides={[0, 0, HAIR, 0]} border={c.borderWeak}>
        <Btn id="phone-email-settings-back" variant="header" label={t("email.workspace.a11y.back")} onPress={onBack}>
          <Icon icon={glyph("chevron-left")} size={16} color={c.textStrong} />
          <text {...T.backText} color={c.textStrong}>
            {t("common.back")}
          </text>
        </Btn>
        <text role="heading" {...T.settingsTitle} color={c.textStrong} shrink minW={0} maxLines={1}>
          {t("email.workspace.rules.settingsTitle")}
        </text>
      </row>

      <Group title={t("email.workspace.rules.yours")}>
        {state.rules.length > 0 ? (
          <HairlineList>
            {state.rules.map((rule) => {
              const removing = removingRuleId === rule.ruleId;
              return (
                <SettingsRow key={rule.ruleId}>
                  <RowCopy main={rule.text} sub={RULE_KIND_LABEL_KEY[rule.kind] ? t(RULE_KIND_LABEL_KEY[rule.kind]) : ""} />
                  <Btn
                    variant="ghost"
                    label={t("email.workspace.rules.remove", { rule: rule.text })}
                    text={removing ? t("global.schedule.removing") : t("email.section.remove")}
                    disabled={removing}
                    onPress={() => void removeRule(rule.ruleId)}
                  />
                </SettingsRow>
              );
            })}
          </HairlineList>
        ) : null}
        <text {...T.footnote} mt={12} color={c.textWeaker}>
          {t("email.workspace.rules.hint")}
        </text>
      </Group>

      <Group title={t("email.workspace.inboxes.title")}>
        <HairlineList>
          {state.accounts.map((account) => (
            <SettingsRow key={account}>
              <row align="center" gap={8} grow={1} minW={0}>
                <Icon icon={glyph("mail")} size={14} color={c.textWeaker} />
                <text {...T.settingsRowMain} color={c.textStrong} maxLines={1} shrink minW={0}>
                  {account}
                </text>
              </row>
              <text {...T.settingsRowValue} color={c.textMuted} shrink={false}>
                {t("email.workspace.inboxes.reading")}
              </text>
            </SettingsRow>
          ))}
          {state.nextReadAt ? (
            <SettingsRow>
              <RowCopy main={t("email.workspace.nextCheck.title")} sub={t("email.workspace.nextCheck.hint")} />
              <text {...T.settingsRowValue} color={c.textMuted} shrink={false}>
                {formatWhen(state.nextReadAt, locale)}
              </text>
            </SettingsRow>
          ) : null}
        </HairlineList>
      </Group>

      <Group title={t("email.workspace.automation")}>
        <HairlineList>
          <SettingsRow>
            <RowCopy main={t("email.workspace.off.title")} sub={t("email.workspace.off.body")} />
            <Btn
              id="phone-email-turn-off"
              variant="secondary"
              label={t("email.workspace.off.title")}
              text={turningOff ? t("email.workspace.off.working") : t("email.section.turnOff")}
              textColor={c.danger}
              disabled={turningOff}
              onPress={() => void confirmTurnOff()}
            />
          </SettingsRow>
        </HairlineList>
      </Group>
    </col>
  );
}

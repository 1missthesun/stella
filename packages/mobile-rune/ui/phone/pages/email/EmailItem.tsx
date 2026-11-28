import { memo } from "react";
import { gmailThreadUrl, type EmailPageItem } from "@stella/contracts/email-page";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useLocale, useT, useTPlural } from "@/shared/i18n";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { glyph } from "../../icons";
import { Btn, formatWhen, HAIR, RichText, Spinner, T, tapLight, useEmailColors } from "./kit";

export type PendingKind = "working" | "sent";

const PENDING_LABEL_KEY: Record<PendingKind, string> = {
  working: "email.workspace.working",
  sent: "email.workspace.tell.sent",
};

export type EmailItemHandlers = {
  toggleOpen: (id: string) => void;
  toggleTell: (id: string) => void;
  closeTell: (id: string) => void;
  setDraft: (id: string, text: string) => void;
  primary: (item: EmailPageItem) => void;
  submitTell: (item: EmailPageItem) => void;
};

const tellId = (id: string) => `phone-email-tell-${id}`;

export const EmailItem = memo(function EmailItem({
  item,
  last,
  open,
  pending,
  telling,
  draftText,
  sending,
  showAccount,
  on,
}: {
  item: EmailPageItem;
  last: boolean;
  open: boolean;
  pending: PendingKind | undefined;
  telling: boolean;
  draftText: string;
  sending: boolean;
  showAccount: boolean;
  on: EmailItemHandlers;
}) {
  const c = useEmailColors();
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const hasMore = Boolean(item.detail || item.draft);
  const thread = item.threads?.[0];
  const time = formatWhen(item.mailAt ?? item.at, locale);
  const secondary = item.section !== "needs_you";
  const handled = item.section === "handled";
  const emphasize = Boolean(item.urgent || (open && item.draft));
  const meta: string[] = [];
  if (item.from) meta.push(item.from);
  if (item.count && item.count > 1) meta.push(tPlural("email.brief.emails", item.count));
  if (showAccount && thread?.account) meta.push(thread.account);
  const sendDisabled = draftText.trim().length === 0 || sending;
  const toggle = () => {
    tapLight();
    on.toggleOpen(item.id);
  };

  return (
    <col id={`phone-email-item-${item.id}`} role="listitem" py={15} borderSides={last ? undefined : [0, 0, HAIR, 0]} border={last ? undefined : c.borderWeak}>
      <col role={hasMore ? "button" : undefined} label={item.title} expanded={hasMore ? open : undefined} focusable={hasMore} onPress={hasMore ? toggle : undefined}>
        <row align="center" gap={8}>
          {item.urgent ? <box w={6} h={6} radius={3} fill={c.accent} shrink={false} /> : null}
          <text {...(secondary ? T.itemTitleMuted : T.itemTitle)} grow={1} minW={0} color={secondary ? c.textBase : c.textStrong}>
            {item.title}
          </text>
          {time ? (
            <text {...T.itemTime} color={c.textWeaker} shrink={false}>
              {time}
            </text>
          ) : null}
        </row>
        {meta.length > 0 ? (
          <text {...T.itemMeta} mt={3} color={c.textMuted} maxLines={1}>
            {meta.join(" · ")}
          </text>
        ) : null}
        <text {...T.itemGist} mt={7} color={secondary ? c.textMuted : c.textBase}>
          {item.gist}
        </text>
      </col>

      {hasMore && open ? (
        <col mt={12} gap={12}>
          {item.detail ? <RichText text={item.detail} /> : null}
          {item.draft ? (
            <col radius={11} border={c.borderWeak} borderWidth={HAIR} fill={c.subtleFill} clip={11}>
              <row align="center" justify="between" gap={8} px={13} py={9} borderSides={[0, 0, HAIR, 0]} border={c.borderWeak}>
                <row align="center" gap={6} shrink={false}>
                  <Icon icon={glyph("reply")} size={12} color={c.textMuted} />
                  <text {...T.draftLabel} color={c.textMuted}>
                    {t("email.workspace.draft.label")}
                  </text>
                </row>
                {item.from ? (
                  <text {...T.draftTo} color={c.textWeaker} maxLines={1} shrink minW={0}>
                    {t("email.reply.to", { to: item.from })}
                  </text>
                ) : null}
              </row>
              <text {...T.draftBody} px={13} py={12} color={c.textStrong} selectable>
                {item.draft}
              </text>
            </col>
          ) : null}
        </col>
      ) : null}

      {pending ? (
        <row role="status" align="center" gap={8} mt={13}>
          <Spinner color={c.textMuted} />
          <text {...T.secondaryBtnText} color={c.textMuted}>
            {t(PENDING_LABEL_KEY[pending])}
          </text>
        </row>
      ) : (
        <>
          <row align="center" gap={8} mt={13}>
            <row grow={1} minW={0} wrap align="center" gap={8}>
              {item.action ? (
                <Btn
                  variant={handled ? "secondary" : emphasize ? "primary" : "tonal"}
                  label={`${item.action}: ${item.title}`}
                  text={item.action}
                  icon={handled ? "arrow-counterclockwise" : undefined}
                  iconSize={12}
                  onPress={() => on.primary(item)}
                />
              ) : null}
              {hasMore ? (
                <Btn
                  variant="ghost"
                  label={open ? t("email.workspace.hideDetails") : item.draft ? t("email.workspace.draft.read") : t("email.workspace.showDetails")}
                  text={open ? t("email.brief.hide") : item.draft ? t("email.workspace.draft.read") : t("email.workspace.details")}
                  onPress={toggle}
                />
              ) : null}
              <Btn
                variant="ghost"
                label={t("email.workspace.tell.about", { title: item.title })}
                text={t("email.workspace.tell.action")}
                onPress={() => {
                  tapLight();
                  on.toggleTell(item.id);
                }}
              />
            </row>
            {thread ? (
              <row
                role="button"
                label={t("email.section.openInGmail")}
                focusable
                shrink={false}
                align="center"
                gap={4}
                minH={32}
                px={6}
                pressScale={0.97}
                onPress={() => {
                  tapLight();
                  openExternalUrl(gmailThreadUrl(thread));
                }}
              >
                <text {...T.gmailBtnText} color={c.textWeaker}>
                  Gmail
                </text>
                <Icon icon={glyph("arrow-up-right")} size={11} color={c.textWeaker} />
              </row>
            ) : null}
          </row>

          {telling ? (
            <col id={tellId(item.id)} mt={12} radius={11} border={c.border} borderWidth={HAIR} fill={c.subtleFill}>
              <input
                id={`${tellId(item.id)}-input`}
                multiline
                value={draftText}
                placeholder={t("email.workspace.tell.placeholder")}
                placeholderColor={c.textWeaker}
                label={t("email.workspace.tell.placeholder")}
                readOnly={sending}
                {...T.tellInput}
                color={c.textStrong}
                caretColor={c.accent}
                minH={72}
                px={13}
                pt={11}
                pb={8}
                onFocus={(focused) => {
                  if (focused) setTimeout(() => void stella.engine.scroll.intoView(tellId(item.id)).catch(() => {}), 350);
                }}
                onInput={(next) => on.setDraft(item.id, next)}
              />
              <row align="center" justify="end" gap={8} px={10} pb={9}>
                <Btn variant="ghost" label={t("common.cancel")} text={t("common.cancel")} onPress={() => on.closeTell(item.id)} />
                <Btn
                  variant="primary"
                  compact
                  label={t("email.workspace.tell.send")}
                  text={sending ? t("userAsk.question.sending") : t("email.digest.send")}
                  disabled={sendDisabled}
                  dim={sendDisabled}
                  onPress={() => on.submitTell(item)}
                />
              </row>
            </col>
          ) : null}
        </>
      )}
    </col>
  );
});

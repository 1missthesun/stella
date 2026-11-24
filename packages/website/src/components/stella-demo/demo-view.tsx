import localFont from "next/font/local";
import type { CSSProperties, ReactNode } from "react";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import { chatItems, parseBlocks, parseInline, type ChatItem, type DemoCard, type DemoInline, type DemoStep } from "@/lib/demo";
import { APP_ICONS, type AppIconName } from "./app-icons.generated";
import { APP_COLUMN, APP_COMPOSER_PLACEHOLDER, APP_TIMING } from "./app-timing.generated";
import "./app.generated.css";
import "./stella-demo.css";

export const manrope = localFont({
  src: "./manrope.woff2",
  weight: "200 800",
  display: "swap",
  preload: false,
  variable: "--sd-manrope",
});

export function AppIcon({ name, size, strokeWidth = 2, fill }: { name: AppIconName; size: number; strokeWidth?: number; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: APP_ICONS[name] }}
    />
  );
}

function Inline({ parts }: { parts: DemoInline[] }) {
  return parts.map((part, i) => {
    if (part.bold) return <strong key={i}>{part.text}</strong>;
    if (part.code) return <code key={i}>{part.text}</code>;
    if (part.href)
      return (
        <a key={i} href={part.href} tabIndex={-1}>
          {part.text}
        </a>
      );
    return part.text;
  });
}

/** Stella's markdown, the subset a demo uses: paragraphs, bullets, bold, links, code. */
export function Rich({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parseBlocks(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i}>
            <Inline parts={block.parts} />
          </p>
        ) : (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline parts={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** The gap above a row, as the app's timeline spaces them (ROW_GAP, ASSISTANT_RUN_GAP, USER_RUN_GAP). */
export function rowGap(prev: ChatItem | undefined, item: ChatItem): number {
  if (!prev) return 0;
  if (item.kind === "user") return prev.kind === "user" ? APP_TIMING.userRunGap : APP_TIMING.rowGap;
  if (prev.kind === "user") return APP_TIMING.rowGap;
  return APP_TIMING.assistantRunGap;
}

function FilePills({ files }: { files: string[] }) {
  return (
    <div className="agent-activity-files agent-activity-files--bubble">
      <div className="agent-activity-files__pills">
        {files.map((file) => (
          <span key={file} className="agent-activity-files__pill">
            <span className="agent-activity-files__pill-open">
              <span className="agent-activity-files__pill-icon">
                <AppIcon name="FileText" size={14} />
              </span>
              <span className="agent-activity-files__pill-name">{fileDisplayName(file)}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Card({ card }: { card: DemoCard }) {
  return (
    <div className="file-preview-card" data-demo-card="">
      <div className="file-preview-card__header">
        <div className="file-preview-card__title-group">
          {card.kind ? <span className="file-preview-card__eyebrow">{card.kind}</span> : null}
          <div className="file-preview-card__title">{card.title}</div>
        </div>
      </div>
      {card.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a demo's own small result image
        <img src={card.image.src} alt={card.image.alt} width={card.image.width} height={card.image.height} loading="lazy" data-demo-card-image="" />
      ) : null}
      {card.lines?.length ? (
        <ul data-demo-card-lines="">
          {card.lines.map((line) => (
            <li key={line}>
              <Inline parts={parseInline(line)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ChatRow({ item, gap, rowRef }: { item: ChatItem; gap: number; rowRef?: (el: HTMLDivElement | null) => void }) {
  const style = { marginTop: gap } as CSSProperties;
  if (item.kind === "user") {
    return (
      <div ref={rowRef} className="event-row event-row--user" style={style} data-demo-row={item.step} data-demo-kind="user">
        <div className="event-item user">
          <div className="event-user-body">
            <div className="event-body chat-bubble-text">
              <span className="sd-sr">You: </span>
              {item.text}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === "card") {
    return (
      <div ref={rowRef} className="event-row event-row--assistant" style={style} data-demo-row={item.step} data-demo-kind="card">
        <div className="event-item assistant">
          <Card card={item.card} />
        </div>
      </div>
    );
  }
  return (
    <div ref={rowRef} className="event-row event-row--assistant" style={style} data-demo-row={item.step} data-demo-kind="assistant">
      <div className="event-item assistant">
        <div className="message-line message-line--assistant">
          <div className="assistant-message-text chat-bubble-text">
            <span className="sd-sr">Stella: </span>
            <Rich text={item.text} />
            {item.files?.length ? <FilePills files={item.files} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const columnStyle: CSSProperties = {
  maxWidth: `min(${APP_COLUMN.maxWidthRem}rem, 100%)`,
  marginInline: "auto",
  paddingLeft: APP_COLUMN.paddingLeft,
  paddingRight: APP_COLUMN.paddingRight,
  paddingTop: APP_COLUMN.paddingTop,
  paddingBottom: APP_COLUMN.paddingBottom,
};

/** Stella's composer: the add button, the field, the mic, stop while working, and send. */
export function ComposerView({
  fieldRef,
  formRef,
  stopRef,
  submitRef,
  slot,
}: {
  fieldRef?: (el: HTMLDivElement | null) => void;
  formRef?: (el: HTMLDivElement | null) => void;
  stopRef?: (el: HTMLButtonElement | null) => void;
  submitRef?: (el: HTMLButtonElement | null) => void;
  slot?: ReactNode;
}) {
  return (
    <div className="composer" aria-hidden="true">
      <div className="composer-shell">
        <div className="composer-shell-content">
          <div ref={formRef} className="composer-form">
            <button type="button" tabIndex={-1} className="chat-composer-icon-button chat-composer-icon-button--add composer-add-button">
              <AppIcon name="Plus" size={16} strokeWidth={1.75} />
            </button>
            <div className="composer-model-mention-field">
              <div ref={fieldRef} className="composer-input chat-composer-field chat-composer-textarea" data-empty="">
                {slot ?? <span className="sd-placeholder">{APP_COMPOSER_PLACEHOLDER}</span>}
              </div>
            </div>
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                <button type="button" tabIndex={-1} className="chat-composer-icon-button chat-composer-icon-button--add composer-add-button composer-add-button--toolbar">
                  <AppIcon name="Plus" size={16} strokeWidth={1.75} />
                </button>
              </div>
              <div className="composer-toolbar-right">
                <button type="button" tabIndex={-1} className="chat-composer-icon-button chat-composer-icon-button--mic composer-mic">
                  <AppIcon name="Mic" size={16} strokeWidth={1.75} />
                </button>
                <button type="button" tabIndex={-1} ref={stopRef} className="chat-composer-icon-button chat-composer-icon-button--stop composer-stop" data-demo-stop="" hidden>
                  <AppIcon name="Square" size={16} fill="currentColor" />
                </button>
                <button type="button" tabIndex={-1} ref={submitRef} className="chat-composer-icon-button chat-composer-icon-button--submit composer-submit" disabled>
                  <AppIcon name="ArrowUp" size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A still of the finished chat for guide cards: the request and Stella's last
 * reply in the app's own rows and styles, with no window chrome and no script.
 */
export function DemoStill({ steps, theme = "light" }: { steps: DemoStep[]; theme?: "light" | "dark" }) {
  const items = chatItems(steps);
  const user = items.find((item) => item.kind === "user");
  const reply = items.findLast((item) => item.kind === "assistant");
  const shown: ChatItem[] = [user, reply].filter((item) => item !== undefined);
  return (
    <div className={`sd sd-still ${manrope.variable}`} data-theme={theme} aria-hidden="true">
      <div className="app">
        <div className="sd-still-column">
          {shown.map((item, i) => (
            <ChatRow key={item.step} item={item} gap={rowGap(shown[i - 1], item)} />
          ))}
        </div>
      </div>
    </div>
  );
}

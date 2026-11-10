import Link from "next/link";
import { Fragment } from "react";
import { linkParts } from "@/lib/answers";

// `code` spans inside plain text, e.g. an install command in a step.
function CodeText({ text }: { text: string }) {
  const bits = text.split(/`([^`]+)`/g);
  if (bits.length === 1) return <>{text}</>;
  return (
    <>
      {bits.map((bit, i) => (i % 2 ? <code key={i}>{bit}</code> : <Fragment key={i}>{bit}</Fragment>))}
    </>
  );
}

export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((part, i) =>
        "href" in part ? (
          part.href.startsWith("/") ? (
            <Link key={i} href={part.href}>
              {part.label}
            </Link>
          ) : (
            <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
              {part.label}
            </a>
          )
        ) : (
          <CodeText key={i} text={part.text} />
        ),
      )}
    </>
  );
}

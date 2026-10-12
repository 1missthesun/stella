import { linkParts } from "@/lib/answers";

export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((part, i) =>
        "href" in part ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.label}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

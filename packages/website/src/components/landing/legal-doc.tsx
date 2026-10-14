import { PageShell } from "./page-shell";
import pg from "./page.module.css";
import d from "./legal-doc.module.css";

type Block = { kind: "heading"; id: string; text: string } | { kind: "para"; text: string };

const HEADING = /^(\d+)\.\s+(\S.{0,90})$/;

function parse(source: string) {
  const lines = source.split("\n");
  const intro: string[] = [];
  let updated = "";
  const chunks = lines.slice(1).join("\n").split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  const blocks: Block[] = [];
  let started = false;
  for (const chunk of chunks) {
    if (!updated && chunk.startsWith("Last updated:")) {
      updated = chunk.replace("Last updated:", "").trim();
      continue;
    }
    const match = chunk.match(HEADING);
    if (match && !chunk.includes("\n")) {
      started = true;
      blocks.push({ kind: "heading", id: `section-${match[1]}`, text: chunk });
      continue;
    }
    if (!started) intro.push(chunk);
    else blocks.push({ kind: "para", text: chunk });
  }
  return { updated, intro, blocks };
}

export function LegalDoc({ title, source, deletionRequest = false }: { title: string; source: string; deletionRequest?: boolean }) {
  const { updated, intro, blocks } = parse(source);
  const headings = blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading");

  return (
    <PageShell>
      <section className={`${pg.hero} ${d.hero}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Stella · FromYou LLC</p>
        <h1 className={pg.title}>{title}</h1>
        {updated ? <p className={d.updated}>Last updated {updated}</p> : null}
        {deletionRequest ? (
          <p className={d.intro}>
            <a href="mailto:contact@fromyou.ai?subject=Delete%20my%20Stella%20account">Request account deletion by email</a>
          </p>
        ) : null}
        {intro.map((text) => (
          <p key={text} className={d.intro}>
            {text}
          </p>
        ))}
      </section>
      <section className={d.body} data-tone="light" data-bg="#ffffff">
        <nav className={d.toc} aria-label="Sections">
          <p>Contents</p>
          <ol>
            {headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text.replace(/^\d+\.\s+/, "")}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className={d.text}>
          {blocks.map((block, i) =>
            block.kind === "heading" ? (
              <h2 key={block.id} id={block.id}>
                {block.text}
              </h2>
            ) : (
              <p key={i}>{block.text}</p>
            ),
          )}
        </article>
      </section>
    </PageShell>
  );
}

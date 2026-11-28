/*
 * /privacy, /terms and /refunds: renders a document from src/legal/legal.ts on the soft info card.
 * Inline markup: **bold**, *italic*, [text](href). Anything still "[TO FILL …]" / "[TO CONFIRM …]"
 * is highlighted so it can't slip through unnoticed.
 */
import { Fragment, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LEGAL_DOCS, UPDATED, type Block } from "../legal/legal";
import "./info-page.css";

const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\[TO (?:FILL|CONFIRM)[^\]]*\])/g;

function inline(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**")) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("[TO ")) return <mark key={i} className="legal-todo">{part}</mark>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return href.startsWith("/") ? (
        <Link key={i} to={href}>
          {label}
        </Link>
      ) : (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        typeof b === "string" ? (
          <p key={i}>{inline(b)}</p>
        ) : (
          <ul key={i}>
            {b.list.map((li, j) => (
              <li key={j}>{inline(li)}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

const OTHERS: { slug: keyof typeof LEGAL_DOCS; label: string }[] = [
  { slug: "privacy", label: "Privacy policy" },
  { slug: "terms", label: "Terms of use" },
  { slug: "refunds", label: "Refund policy" },
];

export default function LegalPage({ doc: slug }: { doc: keyof typeof LEGAL_DOCS }) {
  const doc = LEGAL_DOCS[slug];

  useEffect(() => {
    const prev = document.title;
    document.title = `${doc.title} — Senevon Game Studio`;
    window.scrollTo(0, 0);
    return () => {
      document.title = prev;
    };
  }, [doc.title]);

  return (
    <article className="page info-page legal-page">
      <p className="eyebrow">Legal</p>
      <h1>{doc.title}</h1>
      <p className="privacy-updated">Last updated: {inline(UPDATED)}</p>

      <nav className="legal-switch" aria-label="Legal documents">
        {OTHERS.map((o) =>
          o.slug === slug ? (
            <span key={o.slug} aria-current="page">
              {o.label}
            </span>
          ) : (
            <Link key={o.slug} to={`/${o.slug}`}>
              {o.label}
            </Link>
          ),
        )}
      </nav>

      <Blocks blocks={doc.intro} />

      <nav className="legal-toc" aria-label="Contents">
        <p>Contents</p>
        <ol>
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.h.replace(/^\d+\.\s*/, "")}</a>
            </li>
          ))}
        </ol>
      </nav>

      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="legal-sec">
          <h2>{s.h}</h2>
          <Blocks blocks={s.blocks} />
        </section>
      ))}
    </article>
  );
}

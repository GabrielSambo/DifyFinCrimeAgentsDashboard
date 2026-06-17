"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UboReportHeader } from "@/lib/types";
import { isSectionHeading, slugify, tocFromMarkdown } from "@/lib/ubo-report";
import { Mermaid } from "./Mermaid";

/* ---------- helpers ---------- */

function textContent(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "object" && "props" in node) {
    return textContent((node as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}

/* ---------- header strip ---------- */

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const tone = s.includes("VERIFIED")
    ? "bg-good-bg text-good"
    : s.includes("PROVISIONAL")
      ? "bg-warn-bg text-warn"
      : "bg-surface-2 text-ink-3";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

function ScreeningChip({ header }: { header: UboReportHeader }) {
  if (header.clear == null) return null;
  if (header.clear) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-good-bg px-2 py-0.5 text-xs font-medium text-good">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        No PEP / sanctions hits
      </span>
    );
  }
  const sc = header.screening ?? {};
  const hits = (sc.pep ?? 0) + (sc.sanctions ?? 0) + (sc.debarment ?? 0) + (sc.matches ?? 0);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-bad-bg px-2 py-0.5 text-xs font-medium text-bad">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {hits} screening hit{hits === 1 ? "" : "s"} — review
    </span>
  );
}

function HeaderStrip({ header }: { header: UboReportHeader }) {
  const facts: { label: string; value?: string; mono?: boolean; wide?: boolean }[] = [
    { label: "Company no.", value: header.companyNumber },
    { label: "LEI", value: header.lei, mono: true },
    { label: "Incorporated", value: header.incorporated },
    { label: "Jurisdiction", value: header.jurisdiction },
    { label: "Registered address", value: header.address, wide: true },
  ];
  const hasFacts = facts.some((f) => f.value) || header.subject;
  if (!hasFacts) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Investigation target</div>
          {header.subject && (
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-ink">{header.subject}</h2>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScreeningChip header={header} />
          <StatusBadge status={header.status} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {facts
          .filter((f) => f.value)
          .map((f) => (
            <div key={f.label} className={`min-w-0 ${f.wide ? "col-span-2 sm:col-span-3" : ""}`}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{f.label}</dt>
              <dd
                className={`mt-0.5 text-sm text-ink ${f.mono ? "font-mono" : ""} ${f.wide ? "break-words" : "truncate"}`}
                title={f.value}
              >
                {f.value}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/* ---------- markdown renderers ---------- */

// Numbered sections render prominently and carry a TOC anchor regardless of the
// heading level the agent used (## on some runs, ### on others). Everything else
// renders as a smaller sub-heading.
function Heading({ children, sub = false }: { children: React.ReactNode; sub?: boolean }) {
  const text = textContent(children);
  const section = isSectionHeading(text);
  const id = slugify(text);
  if (section || !sub) {
    return (
      <h2 id={id} className="mt-8 scroll-mt-24 border-b border-border pb-2 text-lg font-semibold tracking-tight text-ink first:mt-0">
        {children}
      </h2>
    );
  }
  return (
    <h3 id={id} className="mt-5 scroll-mt-24 text-sm font-semibold uppercase tracking-wide text-ink-2">
      {children}
    </h3>
  );
}

function buildComponents(): Components {
  return {
    h1: ({ children }) => (
      <h1 className="text-xl font-semibold tracking-tight text-ink">{children}</h1>
    ),
    h2: ({ children }) => <Heading sub={false}>{children}</Heading>,
    h3: ({ children }) => <Heading sub>{children}</Heading>,
    h4: ({ children }) => <Heading sub>{children}</Heading>,
    p: ({ children }) => <p className="my-2.5 text-sm leading-relaxed text-ink-2">{children}</p>,
    ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-5 text-sm text-ink-2">{children}</ul>,
    ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-5 text-sm text-ink-2">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed marker:text-ink-3">{children}</li>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
      >
        {children}
      </a>
    ),
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="my-6 border-border" />,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-border-strong pl-3 text-sm text-ink-3">{children}</blockquote>
    ),
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border px-3 py-2 text-left font-medium text-ink">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border px-3 py-2 align-top text-ink-2">{children}</td>
    ),
    // `pre` is a pass-through so the `code` renderer owns the block wrapper.
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const lang = /language-(\w+)/.exec(className ?? "")?.[1];
      if (lang === "mermaid") {
        return <Mermaid chart={textContent(children)} />;
      }
      if (lang) {
        return (
          <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-surface-2/60 p-3 font-mono text-xs leading-relaxed text-ink-2">
            <code>{children}</code>
          </pre>
        );
      }
      return (
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
      );
    },
  };
}

/* ---------- TOC ---------- */

function Toc({ entries }: { entries: { id: string; label: string }[] }) {
  if (!entries.length) return null;
  return (
    <nav className="sticky top-6 hidden w-56 shrink-0 lg:block">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">On this page</div>
      <ul className="space-y-0.5 border-l border-border">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-xs text-ink-2 transition-colors hover:border-brand hover:text-brand"
            >
              {e.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ---------- top-level ---------- */

const COMPONENTS = buildComponents();

export function UboReport({ markdown, header }: { markdown: string; header: UboReportHeader }) {
  const toc = tocFromMarkdown(markdown);
  const components = COMPONENTS;

  return (
    <div className="space-y-4">
      <HeaderStrip header={header} />
      <div className="flex gap-8">
        <Toc entries={toc} />
        <article className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-6 py-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

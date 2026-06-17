"use client";

import { useEffect, useId, useRef, useState } from "react";

/*
  Client-only Mermaid renderer. `mermaid` is lazy-imported inside the effect so
  it never runs on the server (it touches `document`) and stays out of the
  first-paint bundle. On any parse/render error we fall back to the raw diagram
  source so the analyst still sees the structure instead of a blank box.
*/
export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const id = "mmd-" + rawId.replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          fontFamily: "var(--font-sans)",
        });
        const { svg } = await mermaid.render(id, chart.trim());
        if (active && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-border bg-surface-2/60 p-3">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Ownership diagram (source)
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink-2">{chart.trim()}</pre>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto rounded-lg border border-border bg-surface p-4 [&_svg]:h-auto [&_svg]:max-w-full"
    />
  );
}

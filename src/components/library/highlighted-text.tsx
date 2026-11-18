"use client";

import { useEffect, useRef } from "react";
import { findHighlightRange } from "@/lib/chat/highlight";

/** Plain text with the cited passage marked and scrolled into view. */
export function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  const markRef = useRef<HTMLElement>(null);
  const range = highlight ? findHighlightRange(text, highlight) : null;

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [range?.start]);

  if (!range) return <p className="whitespace-pre-wrap">{text}</p>;
  return (
    <p className="whitespace-pre-wrap">
      {text.slice(0, range.start)}
      <mark ref={markRef} className="cited rounded-sm bg-transparent text-inherit">
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </p>
  );
}

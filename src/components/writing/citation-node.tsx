"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import type { CitationItem } from "@/lib/writing/doc";

export type CitablePaper = { id: string; title: string; authors: string[]; year: number | null; status: string };

/** Live labels and the paper list, shared with every citation chip. */
export const CitationContext = createContext<{
  labels: Record<string, string>;
  papers: Map<string, CitablePaper>;
  onEdit: (pos: number, attrs: { id: string; items: CitationItem[] }) => void;
}>({ labels: {}, papers: new Map(), onEdit: () => {} });

function CitationChip({ node, getPos, selected }: ReactNodeViewProps) {
  const { labels, papers, onEdit } = useContext(CitationContext);
  const attrs = node.attrs as { id: string; items: CitationItem[] };
  const titles = attrs.items.map((i) => papers.get(i.paperId)?.title ?? "A paper that's no longer in your library").join("; ");
  const label = labels[attrs.id] ?? "…";
  const edit = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos === "number") onEdit(pos, attrs);
  };
  // A span (not a <button>, which is always inline-block) so the line can't
  // break between the chip and the punctuation after it.
  return (
    <NodeViewWrapper as="span" className="citation-chip-wrap">
      <span
        role="button"
        tabIndex={0}
        contentEditable={false}
        className={`citation-chip ${selected ? "is-selected" : ""}`}
        title={titles}
        aria-label={`Citation ${label}: ${titles}. Edit citation`}
        onClick={edit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            edit();
          }
        }}
      >
        {label}
      </span>
    </NodeViewWrapper>
  );
}

/** Inline, atomic citation: { id, items: [{ paperId, locator? }] }. */
export const CitationNode = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      id: { default: null },
      items: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute("data-items") ?? "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ "data-items": JSON.stringify(attrs.items) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-citation": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CitationChip, { as: "span" });
  },
});

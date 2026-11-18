import type { MessageCitation } from "@/db/schema";
import type { CitationItem, DocNode } from "./doc";

/**
 * Turn a cited answer (plain text + citation spans) into editor paragraphs,
 * with a citation node right after each cited span. Paragraphs come from
 * blank lines; "- " lines become a bullet list.
 */
export function answerToNodes(text: string, citations: MessageCitation[], newId: () => string): DocNode[] {
  // Group citations by where they end; one node per end position.
  const byEnd = new Map<number, CitationItem[]>();
  for (const c of citations) {
    const list = byEnd.get(c.end) ?? [];
    if (!list.some((i) => i.paperId === c.paperId)) {
      list.push({ paperId: c.paperId, locator: c.locator === "section" ? undefined : String(c.pageNumber) });
    }
    byEnd.set(c.end, list);
  }

  // Walk the text once, emitting inline nodes per paragraph.
  type Para = { bullet: boolean; inline: DocNode[] };
  const paras: Para[] = [];
  let current: Para = { bullet: false, inline: [] };
  let buffer = "";
  const flushText = () => {
    if (buffer) current.inline.push({ type: "text", text: buffer });
    buffer = "";
  };
  const endPara = () => {
    flushText();
    // Trim whitespace at the edges of the paragraph.
    const first = current.inline[0];
    if (first?.type === "text") first.text = first.text!.replace(/^\s+/, "");
    const last = current.inline.at(-1);
    if (last?.type === "text") last.text = last.text!.replace(/\s+$/, "");
    current.inline = current.inline.filter((n) => n.type !== "text" || n.text);
    if (current.inline.length) paras.push(current);
    current = { bullet: false, inline: [] };
  };

  let lineStart = true;
  for (let i = 0; i <= text.length; i++) {
    const items = byEnd.get(i);
    if (items) {
      // Put the citation before trailing punctuation that follows the span.
      flushText();
      current.inline.push({ type: "citation", attrs: { id: newId(), items } });
    }
    if (i === text.length) break;
    const ch = text[i];
    if (ch === "\n") {
      if (text[i + 1] === "\n" || /^- /.test(text.slice(i + 1)) || current.bullet) {
        endPara();
        while (text[i + 1] === "\n") i++;
      } else buffer += " ";
      lineStart = true;
      continue;
    }
    if (lineStart && text.startsWith("- ", i)) {
      current.bullet = true;
      i += 1;
      lineStart = false;
      continue;
    }
    lineStart = false;
    buffer += ch;
  }
  endPara();

  // Merge consecutive bullet paragraphs into lists.
  const nodes: DocNode[] = [];
  for (const p of paras) {
    const paragraph: DocNode = { type: "paragraph", content: p.inline };
    if (p.bullet) {
      const prev = nodes.at(-1);
      const item: DocNode = { type: "listItem", content: [paragraph] };
      if (prev?.type === "bulletList") prev.content!.push(item);
      else nodes.push({ type: "bulletList", content: [item] });
    } else nodes.push(paragraph);
  }
  return nodes;
}

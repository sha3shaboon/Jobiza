import "server-only";
import path from "node:path";
import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { type CitationAttrs, type DocNode, type Run, toBlocks } from "@/lib/writing/doc";
import { renderCitations, toBibtex } from "./citations";

type PaperForCitation = Parameters<typeof renderCitations>[2][number];
export type ExportFormat = "docx" | "pdf" | "latex" | "markdown" | "bibtex";
type Input = { title: string; content: DocNode; style: string; papers: PaperForCitation[] };

function prepare({ content, style, papers }: Input) {
  const rendered = renderCitations(content, style, papers);
  const label = (c: CitationAttrs) => rendered.labels[c.id] ?? "";
  return { blocks: toBlocks(content), rendered, label };
}

/** Citation nodes become their formatted labels, with a space before them when needed. */
function withLabels(runs: Run[], label: (c: CitationAttrs) => string): { text: string; bold?: boolean; italic?: boolean }[] {
  const out: { text: string; bold?: boolean; italic?: boolean }[] = [];
  for (const r of runs) {
    if (!("citation" in r)) {
      out.push(r);
      continue;
    }
    const l = label(r.citation);
    if (!l) continue;
    const prev = out.at(-1)?.text ?? "";
    out.push({ text: (prev && !/\s$/.test(prev) ? " " : "") + l });
  }
  return out;
}

/* ───────────── Markdown ───────────── */

export function toMarkdown(input: Input): string {
  const { blocks, rendered, label } = prepare(input);
  const md = (runs: Run[]) =>
    withLabels(runs, label)
      .map((r) => (r.bold && r.italic ? `***${r.text}***` : r.bold ? `**${r.text}**` : r.italic ? `*${r.text}*` : r.text))
      .join("");
  const lines = [`# ${input.title}`, ""];
  for (const b of blocks) {
    if (b.kind === "heading") lines.push(`${"#".repeat(Math.min(6, b.level))} ${md(b.runs)}`, "");
    else if (b.kind === "paragraph") lines.push(md(b.runs), "");
    else if (b.kind === "quote") lines.push(`> ${md(b.runs)}`, "");
    else {
      b.items.forEach((it, i) => lines.push(`${b.ordered ? `${i + 1}.` : "-"} ${md(it)}`));
      lines.push("");
    }
  }
  if (rendered.bibliography.length) lines.push("## References", "", ...rendered.bibliography.map((e) => e.text), "");
  return lines.join("\n");
}

/* ───────────── Word ───────────── */

export async function toDocx(input: Input): Promise<Buffer> {
  const { blocks, rendered, label } = prepare(input);
  const runs = (r: Run[]) => withLabels(r, label).map((x) => new TextRun({ text: x.text, bold: x.bold, italics: x.italic }));
  const children: Paragraph[] = [new Paragraph({ text: input.title, heading: HeadingLevel.TITLE })];
  for (const b of blocks) {
    if (b.kind === "heading") children.push(new Paragraph({ children: runs(b.runs), heading: b.level <= 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 }));
    else if (b.kind === "paragraph") children.push(new Paragraph({ children: runs(b.runs), spacing: { after: 160 } }));
    else if (b.kind === "quote") children.push(new Paragraph({ children: runs(b.runs), indent: { left: 720 }, spacing: { after: 160 } }));
    else
      for (const item of b.items)
        children.push(
          new Paragraph({
            children: runs(item),
            ...(b.ordered ? { numbering: { reference: "jobiza-numbers", level: 0 } } : { bullet: { level: 0 } }),
          }),
        );
  }
  if (rendered.bibliography.length) {
    children.push(new Paragraph({ text: "References", heading: HeadingLevel.HEADING_1 }));
    for (const e of rendered.bibliography) {
      children.push(new Paragraph({ children: [new TextRun(e.text)], indent: { left: 720, hanging: 720 }, spacing: { after: 120 } }));
    }
  }
  const doc = new Document({
    creator: "Jobiza",
    title: input.title,
    styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
    numbering: {
      config: [{ reference: "jobiza-numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] }],
    },
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/* ───────────── PDF ───────────── */

export async function toPdf(input: Input): Promise<Buffer> {
  const { blocks, rendered, label } = prepare(input);
  // pdfmake's Node build; fonts are the bundled Roboto files.
  const pdfmake = (await import("pdfmake")).default as unknown as {
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setLocalAccessPolicy(cb: (p: string) => boolean): void;
    createPdf(def: unknown): { getBuffer(): Promise<Buffer> };
  };
  const fontDir = path.join(process.cwd(), "node_modules/pdfmake/build/fonts/Roboto");
  pdfmake.setFonts({
    Roboto: {
      normal: path.join(fontDir, "Roboto-Regular.ttf"),
      bold: path.join(fontDir, "Roboto-Medium.ttf"),
      italics: path.join(fontDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
    },
  });
  pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(fontDir));
  const text = (r: Run[]) => withLabels(r, label).map((x) => ({ text: x.text, bold: x.bold, italics: x.italic }));
  const content: unknown[] = [{ text: input.title, style: "title" }];
  for (const b of blocks) {
    if (b.kind === "heading") content.push({ text: text(b.runs), style: b.level <= 2 ? "h1" : "h2" });
    else if (b.kind === "paragraph") content.push({ text: text(b.runs), style: "p" });
    else if (b.kind === "quote") content.push({ text: text(b.runs), style: "quote" });
    else content.push({ [b.ordered ? "ol" : "ul"]: b.items.map((it) => ({ text: text(it) })), style: "p" });
  }
  if (rendered.bibliography.length) {
    content.push({ text: "References", style: "h1" });
    for (const e of rendered.bibliography) content.push({ text: e.text, style: "ref" });
  }
  const def = {
    info: { title: input.title, creator: "Jobiza" },
    pageMargins: [64, 64, 64, 64],
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.35 },
    content,
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 16] },
      h1: { fontSize: 14, bold: true, margin: [0, 14, 0, 6] },
      h2: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
      p: { margin: [0, 0, 0, 8] },
      quote: { margin: [24, 0, 0, 8], italics: true },
      ref: { fontSize: 10, margin: [0, 0, 0, 5] },
    },
  };
  return pdfmake.createPdf(def).getBuffer();
}

/* ───────────── LaTeX ───────────── */

const BIBLATEX: Record<string, string> = {
  apa: "\\usepackage[style=apa,backend=biber]{biblatex}",
  "modern-language-association": "\\usepackage[style=mla,backend=biber]{biblatex}",
  "chicago-author-date": "\\usepackage[authordate,backend=biber]{biblatex-chicago}",
  ieee: "\\usepackage[style=ieee,backend=biber]{biblatex}",
  vancouver: "\\usepackage[style=vancouver,backend=biber]{biblatex}",
  "harvard-cite-them-right": "\\usepackage[style=authoryear,backend=biber]{biblatex}",
};

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
};

/** Escape text for LaTeX in one pass, so replacements are never re-escaped. */
export function escapeLatex(s: string): string {
  return s.replace(/[\\#$%&_{}~^<>]/g, (ch) => LATEX_ESCAPES[ch]);
}

export async function toLatexZip(input: Input): Promise<Buffer> {
  const { blocks } = prepare(input);
  const cited = [...new Set(blocks.flatMap((b) => ("runs" in b ? b.runs : b.items.flat())).flatMap((r) => ("citation" in r ? r.citation.items.map((i) => i.paperId) : [])))];
  const papers = input.papers.filter((p) => cited.includes(p.id));
  const { bibtex, keys } = toBibtex(papers);
  const tex = (runs: Run[]) =>
    runs
      .map((r) => {
        if ("citation" in r) {
          const items = r.citation.items.filter((i) => keys.has(i.paperId));
          if (!items.length) return "";
          const single = items.length === 1 && items[0].locator ? `[p.~${escapeLatex(items[0].locator)}]` : "";
          return `\\autocite${single}{${items.map((i) => keys.get(i.paperId)).join(",")}}`;
        }
        const t = escapeLatex(r.text).replace(/\n/g, "\\\\\n");
        return r.bold ? `\\textbf{${t}}` : r.italic ? `\\emph{${t}}` : t;
      })
      .join("");
  const body: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") body.push(`\\${b.level <= 2 ? "section" : "subsection"}{${tex(b.runs)}}`);
    else if (b.kind === "paragraph") body.push(tex(b.runs));
    else if (b.kind === "quote") body.push(`\\begin{quote}\n${tex(b.runs)}\n\\end{quote}`);
    else body.push(`\\begin{${b.ordered ? "enumerate" : "itemize"}}\n${b.items.map((it) => `  \\item ${tex(it)}`).join("\n")}\n\\end{${b.ordered ? "enumerate" : "itemize"}}`);
  }
  const main = `% Exported from Jobiza. Compile with: pdflatex main && biber main && pdflatex main
\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{csquotes}
${BIBLATEX[input.style] ?? BIBLATEX.apa}
\\addbibresource{references.bib}

\\title{${escapeLatex(input.title)}}
\\date{}

\\begin{document}
\\maketitle

${body.join("\n\n")}

\\printbibliography
\\end{document}
`;
  const zip = new JSZip();
  zip.file("main.tex", main);
  zip.file("references.bib", bibtex);
  return zip.generateAsync({ type: "nodebuffer" });
}

export function bibtexFor(input: Input): string {
  const { blocks } = prepare(input);
  const ids = new Set(blocks.flatMap((b) => ("runs" in b ? b.runs : b.items.flat())).flatMap((r) => ("citation" in r ? r.citation.items.map((i) => i.paperId) : [])));
  return toBibtex(input.papers.filter((p) => ids.has(p.id))).bibtex;
}

import { DOMParser } from "linkedom";
import { normalizeText } from "./text";
import { splitIntoSections } from "./web";

export type JatsArticle = { title?: string; authors: string[]; abstract?: string; doi?: string; sections: string[] };

const text = (el: Element | null | undefined) => normalizeText(el?.textContent ?? "");

/**
 * Parse a JATS XML article (Europe PMC full text) into title, authors,
 * abstract and roughly page-sized sections of body text. References,
 * tables and figure files are left out; figure captions stay.
 */
export function parseJats(xml: string): JatsArticle {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const meta = doc.getElementsByTagName("article-meta")[0];
  const title = text(meta?.getElementsByTagName("article-title")[0]) || undefined;
  const authors = [...(meta?.getElementsByTagName("contrib") ?? [])]
    .filter((c) => c.getAttribute("contrib-type") === "author")
    .flatMap((c) => {
      const given = text(c.getElementsByTagName("given-names")[0]);
      const surname = text(c.getElementsByTagName("surname")[0]);
      const name = [given, surname].filter(Boolean).join(" ") || text(c.getElementsByTagName("collab")[0]);
      return name ? [name] : [];
    });
  const abstract = [...(meta?.getElementsByTagName("abstract")[0]?.getElementsByTagName("p") ?? [])].map(text).filter(Boolean).join("\n\n") || undefined;
  const doi = [...(meta?.getElementsByTagName("article-id") ?? [])].find((a) => a.getAttribute("pub-id-type") === "doi")?.textContent?.trim();

  const body = doc.getElementsByTagName("body")[0];
  const blocks: string[] = [];
  if (body) {
    const walk = (node: Element) => {
      for (const el of [...node.children]) {
        const tag = el.tagName.toLowerCase();
        if (tag === "title") blocks.push(text(el));
        else if (tag === "p") blocks.push(text(el));
        else if (tag === "caption") blocks.push(`[Figure/table: ${text(el)}]`);
        else if (!["table-wrap-foot", "table", "graphic", "media", "ref-list", "xref"].includes(tag)) walk(el);
      }
    };
    walk(body);
  }
  const bodyText = blocks.filter(Boolean).join("\n\n");
  return { title, authors, abstract, doi, sections: bodyText ? splitIntoSections(bodyText) : [] };
}

/** PMC links (pmc.ncbi.nlm.nih.gov/articles/PMC…) → Europe PMC's open full-text endpoint. */
export function europePmcFullTextUrl(url: string): string | null {
  const m = url.match(/(?:pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc)\/articles\/(PMC\d+)/i);
  return m ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${m[1].toUpperCase()}/fullTextXML` : null;
}

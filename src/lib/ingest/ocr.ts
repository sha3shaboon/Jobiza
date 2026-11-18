import Anthropic from "@anthropic-ai/sdk";
import { singlePagePdf } from "./pdf";
import { normalizeText } from "./text";

const OCR_PROMPT = `This is one page from a research document. Transcribe all of its text exactly as written, in reading order.
- Keep headings, paragraphs and list items on their own lines.
- Write tables as plain rows with cells separated by " | ".
- Describe figures in one bracketed line, e.g. [Figure: bar chart of recall by condition].
- Do not summarise, translate, correct or add anything.
Reply with the transcription only.`;

/**
 * Reads a scanned page with Claude (the user's own key and chosen model).
 * The page is sent as a one-page PDF, which Claude reads visually.
 */
export async function ocrPage(
  data: Buffer,
  pageNumber: number,
  { apiKey, model }: { apiKey: string; model: string },
): Promise<string> {
  const page = await singlePagePdf(data, pageNumber);
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: page.toString("base64") } },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return "";
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  return normalizeText(text);
}

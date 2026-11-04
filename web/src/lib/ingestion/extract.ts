import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { config } from "@/lib/config";
import type { ChunkDraft } from "./chunk";
import { chunkPage } from "./chunk";

export type ExtractedPage = {
  pageNumber: number | null;
  text: string;
};

export class DocumentExtractionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EMPTY_DOCUMENT"
      | "INVALID_TEXT_ENCODING"
      | "PDF_PARSE_FAILED"
      | "PDF_PAGE_LIMIT",
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

function joinPdfTextItems(items: unknown[]): string {
  let text = "";
  let previous:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | undefined;

  for (const item of items) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("str" in item) ||
      typeof item.str !== "string"
    ) {
      continue;
    }

    const positioned = item as {
      str: string;
      transform?: number[];
      width?: number;
      height?: number;
      hasEOL?: boolean;
    };
    const x = positioned.transform?.[4] ?? 0;
    const y = positioned.transform?.[5] ?? 0;
    const width = positioned.width ?? 0;
    const height = Math.abs(positioned.height ?? 0);

    if (previous) {
      const sameLine =
        Math.abs(previous.y - y) <=
        Math.max(previous.height, height, 1) * 0.55;

      if (!sameLine) {
        text = `${text.trimEnd()}\n`;
      } else if (
        x > previous.x + previous.width + Math.max(previous.height, height, 1) * 0.2 &&
        !text.endsWith(" ") &&
        !text.endsWith("\n")
      ) {
        text += " ";
      }
    }

    text += positioned.str;
    if (positioned.hasEOL) {
      text = `${text.trimEnd()}\n`;
    }
    previous = { x, y, width, height };
  }

  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractTextFile(bytes: Uint8Array): ExtractedPage[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentExtractionError(
      "The text file is not valid UTF-8.",
      "INVALID_TEXT_ENCODING",
    );
  }

  if (text.includes("\0") || !text.trim()) {
    throw new DocumentExtractionError(
      "The text file contains no searchable text.",
      "EMPTY_DOCUMENT",
    );
  }

  return [{ pageNumber: null, text }];
}

export async function extractPdfText(
  bytes: Uint8Array,
): Promise<ExtractedPage[]> {
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    if (pdf.numPages > config.maxPdfPages) {
      throw new DocumentExtractionError(
        `PDFs may contain at most ${config.maxPdfPages} pages.`,
        "PDF_PAGE_LIMIT",
      );
    }

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        text: joinPdfTextItems(content.items),
      });
      page.cleanup();
    }

    if (!pages.some((page) => page.text.trim())) {
      throw new DocumentExtractionError(
        "No text could be extracted. Scanned PDFs need OCR, which is not enabled in this demo yet.",
        "EMPTY_DOCUMENT",
      );
    }
    return pages;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }
    throw new DocumentExtractionError(
      "The PDF could not be read. Check that it is not damaged or password-protected.",
      "PDF_PARSE_FAILED",
    );
  } finally {
    await loadingTask?.destroy();
  }
}

export function chunkPages(pages: ExtractedPage[]): ChunkDraft[] {
  let section: string | null = null;
  return pages.flatMap((page) =>
    chunkPage(page.text, page.pageNumber).map((chunk) => {
      section = chunk.section ?? section;
      return { ...chunk, section };
    }),
  );
}

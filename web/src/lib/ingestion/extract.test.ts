import { describe, expect, it } from "vitest";

import {
  DocumentExtractionError,
  extractPdfText,
  extractTextFile,
} from "./extract";

function createTextPdf(): Buffer {
  const stream = "BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("extractTextFile", () => {
  it("extracts UTF-8 text as an unpaginated passage", () => {
    expect(extractTextFile(new TextEncoder().encode("Document text"))).toEqual([
      { pageNumber: null, text: "Document text" },
    ]);
  });

  it("rejects empty and invalid UTF-8 documents", () => {
    expect(() => extractTextFile(new Uint8Array())).toThrow(
      DocumentExtractionError,
    );
    try {
      extractTextFile(new Uint8Array([0xc3, 0x28]));
      throw new Error("Expected invalid UTF-8 to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentExtractionError);
      expect((error as DocumentExtractionError).code).toBe(
        "INVALID_TEXT_ENCODING",
      );
    }
  });
});

describe("extractPdfText", () => {
  it("extracts text when the stored PDF bytes are a Node Buffer", async () => {
    await expect(extractPdfText(createTextPdf())).resolves.toEqual([
      { pageNumber: 1, text: "Hello PDF" },
    ]);
  });
});

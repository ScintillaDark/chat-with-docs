import { describe, expect, it } from "vitest";

import { config } from "@/lib/config";
import { chunkPage } from "./chunk";
import { chunkPages } from "./extract";

describe("chunkPage", () => {
  it("preserves code blocks as code and keeps the source page", () => {
    const chunks = chunkPage(
      [
        "The module returns a greeting.",
        "",
        "```ts",
        "export function greet(name: string) {",
        '  return `Hello ${name}`;',
        "}",
        "```",
      ].join("\n"),
      4,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      contentType: "prose",
      pageNumber: 4,
    });
    expect(chunks[1]).toMatchObject({
      contentType: "code",
      pageNumber: 4,
    });
    expect(chunks[1].content).toContain("export function greet");
  });

  it("splits long text within the configured chunk size", () => {
    const sentence =
      "This sentence contains enough ordinary prose to provide a searchable passage. ";
    const chunks = chunkPage(sentence.repeat(50), 2);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= config.chunkCharacters))
      .toBe(true);
    expect(chunks.every((chunk) => chunk.pageNumber === 2)).toBe(true);
  });

  it("preserves section headings across page boundaries", () => {
    const chunks = chunkPages([
      {
        pageNumber: 1,
        text: "PROFESSIONAL EXPERIENCE\nRole — Company\nJanuary 2020 – Present",
      },
      {
        pageNumber: 2,
        text: "More responsibilities for the same role.",
      },
      {
        pageNumber: 3,
        text: "EDUCATION\nBachelor of Engineering",
      },
    ]);

    expect(chunks.map((chunk) => chunk.section)).toEqual([
      "PROFESSIONAL EXPERIENCE",
      "PROFESSIONAL EXPERIENCE",
      "EDUCATION",
    ]);
  });
});

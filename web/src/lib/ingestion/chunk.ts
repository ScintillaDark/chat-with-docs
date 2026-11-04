import { config } from "@/lib/config";

export type ChunkDraft = {
  content: string;
  contentType: "prose" | "code";
  pageNumber: number | null;
  section: string | null;
};

type Segment = {
  content: string;
  contentType: ChunkDraft["contentType"];
};

const codeLinePattern =
  /^\s*(?:```|(?:const|let|var|function|class|import|export|return|if|else|for|while|def|async|await|SELECT|INSERT|CREATE|UPDATE|DELETE)\b|\/\/|#include\b|[{}[\];])|=>|;\s*$/;
const namedSectionHeading =
  /^(?:#{1,6}\s*)?(?:professional|executive|career|work|employment)\s+(?:summary|experience|history)\b|^(?:technical\s+)?skills(?:\s+matrix)?\b|^education(?:al\s+background)?\b|^(?:selected\s+)?projects?\b|^certifications?\b/i;

function isSectionHeading(line: string): boolean {
  const normalized = line.trim().replace(/^#{1,6}\s*/, "");
  if (!normalized || normalized.length > 100 || /[.!?]$/.test(normalized)) {
    return false;
  }
  if (namedSectionHeading.test(normalized)) {
    return true;
  }

  const letters = normalized.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = normalized.match(/\p{Lu}/gu) ?? [];
  return (
    letters.length >= 3 &&
    uppercaseLetters.length / letters.length >= 0.8 &&
    !/[-—–:|]|\b\d{4}\b/.test(normalized)
  );
}

function findSectionHeading(content: string): string | null {
  return (
    content
      .split("\n")
      .map((line) => line.trim())
      .find(isSectionHeading) ?? null
  );
}

function isCodeBlock(value: string): boolean {
  const lines = value.split("\n").filter((line) => line.trim().length > 0);
  return (
    lines.length > 0 &&
    lines.filter((line) => codeLinePattern.test(line)).length / lines.length >=
      0.4
  );
}

function splitByCodeFences(value: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /```[\s\S]*?(?:```|$)/g;
  let cursor = 0;
  let match = pattern.exec(value);

  while (match) {
    const prose = value.slice(cursor, match.index).trim();
    if (prose) {
      segments.push({
        content: prose,
        contentType: isCodeBlock(prose) ? "code" : "prose",
      });
    }

    segments.push({ content: match[0].trim(), contentType: "code" });
    cursor = match.index + match[0].length;
    match = pattern.exec(value);
  }

  const remainder = value.slice(cursor).trim();
  if (remainder) {
    segments.push({
      content: remainder,
      contentType: isCodeBlock(remainder) ? "code" : "prose",
    });
  }

  return segments;
}

function splitLongSegment(
  segment: Segment,
  pageNumber: number | null,
): ChunkDraft[] {
  const { chunkCharacters, chunkOverlapCharacters } = config;
  const chunks: ChunkDraft[] = [];
  let start = 0;

  while (start < segment.content.length) {
    let end = Math.min(start + chunkCharacters, segment.content.length);
    if (end < segment.content.length) {
      const boundary = segment.content.lastIndexOf(
        segment.contentType === "code" ? "\n" : " ",
        end,
      );
      if (boundary > start + chunkCharacters * 0.55) {
        end = boundary;
      }
    }

    const content = segment.content.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        contentType: segment.contentType,
        pageNumber,
        section: null,
      });
    }

    if (end >= segment.content.length) {
      break;
    }

    const nextStart = Math.max(start + 1, end - chunkOverlapCharacters);
    start = nextStart;
    while (start < segment.content.length && /\s/.test(segment.content[start])) {
      start += 1;
    }
  }

  return chunks;
}

export function chunkPage(
  text: string,
  pageNumber: number | null,
): ChunkDraft[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const segments = splitByCodeFences(normalized).flatMap((segment) => {
    if (segment.contentType === "code") {
      return [segment];
    }

    return segment.content
      .split(/\n{2,}/)
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content) => ({
        content,
        contentType: isCodeBlock(content) ? "code" as const : "prose" as const,
      }));
  });

  const drafts: ChunkDraft[] = [];
  let pending: Segment | null = null;

  for (const segment of segments) {
    if (
      pending &&
      pending.contentType === segment.contentType &&
      pending.content.length + segment.content.length + 2 <= chunkCharactersLimit()
    ) {
      pending.content += `\n\n${segment.content}`;
      continue;
    }

    if (pending) {
      drafts.push(...splitLongSegment(pending, pageNumber));
    }
    pending = { ...segment };
  }

  if (pending) {
    drafts.push(...splitLongSegment(pending, pageNumber));
  }

  let section: string | null = null;
  return drafts.map((draft) => {
    section = findSectionHeading(draft.content) ?? section;
    return { ...draft, section };
  });
}

function chunkCharactersLimit(): number {
  return config.chunkCharacters;
}

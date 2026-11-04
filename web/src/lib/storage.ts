import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { config } from "./config";

const storedFilePattern = /^[0-9a-f-]{36}\.(?:pdf|txt)$/i;

function storedFilePath(reference: string): string {
  if (!storedFilePattern.test(reference)) {
    throw new Error("Stored file reference is invalid.");
  }

  const directory = resolve(config.documentStorageDir);
  const path = resolve(directory, reference);
  if (!path.startsWith(`${directory}${sep}`)) {
    throw new Error("Stored file path escaped the private storage directory.");
  }
  return path;
}

export async function saveOriginal(
  extension: "pdf" | "txt",
  bytes: Uint8Array,
): Promise<{ reference: string }> {
  const reference = `${randomUUID()}.${extension}`;
  const directory = resolve(config.documentStorageDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(storedFilePath(reference), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return { reference };
}

export async function readOriginal(reference: string): Promise<Buffer> {
  return readFile(storedFilePath(reference));
}

export async function removeOriginal(reference: string): Promise<void> {
  await unlink(storedFilePath(reference));
}

export async function restoreOriginal(
  reference: string,
  bytes: Uint8Array,
): Promise<void> {
  const path = storedFilePath(reference);
  await mkdir(resolve(config.documentStorageDir), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
}

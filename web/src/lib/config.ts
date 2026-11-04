import { resolve } from "node:path";
import { z } from "zod";

const ollamaUrl = z
  .string()
  .url()
  .default("http://127.0.0.1:11434")
  .refine((value) => {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  }, "Ollama must be hosted on this machine.");

const environment = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://chatdocs:chatdocs@127.0.0.1:5432/chatdocs"),
    DOCUMENT_STORAGE_DIR: z.string().optional(),
    OLLAMA_BASE_URL: ollamaUrl,
    OLLAMA_EMBEDDING_MODEL: z
      .string()
      .trim()
      .min(1)
      .default("nomic-embed-text"),
    GEMINI_API_KEY: z.string().trim().optional(),
    GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.6-flash"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .parse(process.env);

export const config = {
  databaseUrl: environment.DATABASE_URL,
  documentStorageDir:
    environment.DOCUMENT_STORAGE_DIR ??
    resolve(process.cwd(), "..", "data", "uploads"),
  ollamaBaseUrl: environment.OLLAMA_BASE_URL.replace(/\/+$/, ""),
  ollamaEmbeddingModel: environment.OLLAMA_EMBEDDING_MODEL,
  geminiApiKey: environment.GEMINI_API_KEY,
  geminiModel: environment.GEMINI_MODEL,
  embeddingModelVersion: `${environment.OLLAMA_EMBEDDING_MODEL}:768:${
    environment.OLLAMA_EMBEDDING_MODEL.split(":")[0] === "nomic-embed-text"
      ? "nomic-task-prefix-v1"
      : "raw-input-v1"
  }`,
  logLevel: environment.LOG_LEVEL,
  embeddingDimensions: 768,
  maxDocuments: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTextFileBytes: 1024 * 1024,
  maxPdfPages: 50,
  maxQuestionCharacters: 2_000,
  maxChunksPerDocument: 250,
  chunkCharacters: 1_200,
  chunkOverlapCharacters: 150,
  ollamaRequestTimeoutMs: 120_000,
  geminiRequestTimeoutMs: 120_000,
  embeddingBatchSize: 16,
  retrievalCount: 4,
  retrievalCandidateCount: 8,
  neighborExpansionSeeds: 2,
  minimumSimilarity: 0.25,
  maxPromptCharacters: 8_000,
  maxListPromptCharacters: 12_000,
} as const;

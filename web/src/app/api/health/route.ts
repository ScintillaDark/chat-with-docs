import { randomUUID } from "node:crypto";

import { pool } from "@/db";
import { config } from "@/lib/config";
import { isGeminiConfigured } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { ollama } from "@/lib/ollama";

export async function GET() {
  const requestId = randomUUID();
  let database = false;
  let ollamaReady = false;

  try {
    await pool.query("SELECT 1");
    database = true;
  } catch (error) {
    logger.warn(
      {
        event: "health.database_unavailable",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Database health check failed",
    );
  }

  try {
    const response = await ollama.list();
    const installedModels = new Set(
      response.models.map((model) => model.name.replace(/:latest$/, "")),
    );
    ollamaReady = installedModels.has(
      config.ollamaEmbeddingModel.replace(/:latest$/, ""),
    );
  } catch (error) {
    logger.warn(
      {
        event: "health.ollama_unavailable",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Ollama health check failed",
    );
  }

  return Response.json({
    database,
    ollama: ollamaReady,
    gemini: isGeminiConfigured(),
    requestId,
  });
}

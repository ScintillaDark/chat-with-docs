import { eq } from "drizzle-orm";

import { db } from "@/db";
import { collections } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { config } from "@/lib/config";

export const DEFAULT_COLLECTION_ID = "00000000-0000-4000-8000-000000000001";

export async function getDefaultCollection() {
  await db
    .insert(collections)
    .values({
      id: DEFAULT_COLLECTION_ID,
      displayName: "My documents",
      activeEmbeddingModelVersion: config.embeddingModelVersion,
      embeddingDimensions: config.embeddingDimensions,
    })
    .onConflictDoNothing({ target: collections.id });

  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, DEFAULT_COLLECTION_ID))
    .limit(1);

  if (!collection) {
    throw new Error("The default document collection could not be loaded.");
  }

  return collection;
}

export async function ensureDefaultCollection() {
  const collection = await getDefaultCollection();

  if (
    collection.activeEmbeddingModelVersion !== config.embeddingModelVersion ||
    collection.embeddingDimensions !== config.embeddingDimensions
  ) {
    throw new ApiError(
      "The configured embedding model differs from the indexed collection. Rebuild the local index before changing embedding models.",
      409,
      "EMBEDDING_MODEL_MISMATCH",
    );
  }

  return collection;
}

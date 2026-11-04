import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const documentStatus = pgEnum("document_status", [
  "processing",
  "ready",
  "partial",
  "failed",
]);

export const evidenceType = pgEnum("evidence_type", [
  "prose",
  "code",
  "ocr",
  "visual_description",
]);

export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  activeEmbeddingModelVersion: text("active_embedding_model_version").notNull(),
  embeddingDimensions: integer("embedding_dimensions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256Checksum: text("sha256_checksum").notNull(),
    originalFileRef: text("original_file_ref").notNull(),
    processingStatus: documentStatus("processing_status")
      .default("processing")
      .notNull(),
    visualOcrCoverageStatus: text("visual_ocr_coverage_status")
      .default("not_processed")
      .notNull(),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("documents_collection_checksum_unique").on(
      table.collectionId,
      table.sha256Checksum,
    ),
    index("documents_collection_status_idx").on(
      table.collectionId,
      table.processingStatus,
    ),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    contentType: evidenceType("content_type").notNull(),
    content: text("content").notNull(),
    pageNumber: integer("page_number"),
    section: text("section"),
    visualReference: text("visual_reference"),
    embeddingModelVersion: text("embedding_model_version").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chunks_document_index_unique").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("chunks_document_id_idx").on(table.documentId),
    index("chunks_content_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${table.content} || ' ' || coalesce(${table.section}, ''))`,
    ),
  ],
);

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('processing', 'ready', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('prose', 'code', 'ocr', 'visual_description');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content_type" "evidence_type" NOT NULL,
	"content" text NOT NULL,
	"page_number" integer,
	"section" text,
	"visual_reference" text,
	"embedding_model_version" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"active_embedding_model_version" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256_checksum" text NOT NULL,
	"original_file_ref" text NOT NULL,
	"processing_status" "document_status" DEFAULT 'processing' NOT NULL,
	"visual_ocr_coverage_status" text DEFAULT 'not_processed' NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_document_index_unique" ON "chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_collection_checksum_unique" ON "documents" USING btree ("collection_id","sha256_checksum");--> statement-breakpoint
CREATE INDEX "documents_collection_status_idx" ON "documents" USING btree ("collection_id","processing_status");
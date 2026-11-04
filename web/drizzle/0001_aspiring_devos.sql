CREATE INDEX "chunks_content_search_idx" ON "chunks" USING gin (to_tsvector('simple', "content" || ' ' || coalesce("section", '')));
--> statement-breakpoint
WITH detected AS (
	SELECT
		"id",
		"document_id",
		"chunk_index",
		substring(
			"content"
			FROM '(?im)^[[:space:]]*((professional|executive|career|work|employment)[[:space:]]+(summary|experience|history)|([[:alpha:]]+[[:space:]]+)?skills([[:space:]]+matrix)?|education(al[[:space:]]+background)?|projects?|certifications?)[^\n]*'
		) AS section_heading
	FROM "chunks"
),
sectioned AS (
	SELECT
		"id",
		"document_id",
		"chunk_index",
		max("chunk_index") FILTER (WHERE section_heading IS NOT NULL) OVER (
			PARTITION BY "document_id"
			ORDER BY "chunk_index"
			ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
		) AS section_index
	FROM detected
)
UPDATE "chunks" AS target
SET "section" = source.section_heading
FROM sectioned
JOIN detected AS source
	ON source."document_id" = sectioned."document_id"
	AND source."chunk_index" = sectioned.section_index
WHERE target."id" = sectioned."id"
	AND target."section" IS NULL
	AND sectioned.section_index IS NOT NULL;
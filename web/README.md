# Pagewise local document assistant

Pagewise is a local interview-demo application for chatting with PDF and TXT
documents. It uses Next.js, PostgreSQL with pgvector, and Ollama for local
embeddings and retrieval. Gemini generates answers from the retrieved evidence.
Uploaded files, embeddings, and retrieval remain on this machine, but relevant
document excerpts and questions are sent to Google's Gemini API.

## Requirements

- Node.js 24 or newer and npm
- Docker Engine with Docker Compose
- Ollama installed locally
- A Gemini API key from Google AI Studio

Gemini `gemini-3.6-flash` is the default answer model. `nomic-embed-text`
generates local embeddings; its weights are not included in this project, so
download it locally with the command below.
Nomic embeddings use `search_document:` for indexed text and `search_query:`
for questions so the vectors match the model's asymmetric retrieval training.
The Gemini free tier has quotas, and Google may use free-tier prompts to
improve its products. Do not query sensitive documents unless you accept those
terms; see Google's [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [terms](https://ai.google.dev/gemini-api/docs/terms).

## Local setup

From the repository root:

```bash
cp web/.env.example web/.env
docker compose up -d db
```

In another terminal, start Ollama and download the models:

```bash
ollama serve
ollama pull nomic-embed-text
```

Create a key in [Google AI Studio](https://aistudio.google.com/apikey), then
replace `GEMINI_API_KEY` in `web/.env`. Keep this key private. Set `GEMINI_MODEL`
there if you want to use another model available to your API key.

Then start the application:

```bash
cd web
npm ci
npm run db:migrate
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The default database
settings are for the local Compose service; adjust `web/.env` if needed.
`DOCUMENT_STORAGE_DIR` can be set to change where original uploads are stored.
Keep this path private and outside version control.

## Supported workflow and current limits

- Upload PDF and UTF-8 TXT files, with per-file size and PDF page limits.
- Extract text, preserve page numbers, identify code passages, and index them
  with local Ollama embeddings.
- Ask questions against the active collection; responses include citations
  selected from retrieved evidence and abstain when evidence is insufficient.
- Gemini receives the question and selected evidence excerpts to generate the
  answer. The free tier may use prompts to improve Google's products.
- The visible transcript is saved in this browser's local storage so it
  survives refreshes. It is not sent to the server as conversation context;
  "New conversation" clears it. Treat the browser profile as sensitive because
  transcript text can include document-derived answers.
- Chunks preserve page and detected section headings. Q&A combines semantic
  vector search with PostgreSQL full-text search, fuses the ranked results,
  and adds adjacent chunks for context before generation. The context remains
  bounded, so exhaustive coverage of long documents is not guaranteed.
- Gemini requests time out after 120 seconds. List questions allow up to 512
  output tokens; other answers allow 256 tokens. List prompts can include up
  to 12,000 characters so all fitting evidence items are available to
  generation.
- Transient Gemini server errors (HTTP 500/502/503/504) are retried up to two
  times with exponential backoff and jitter. A persistent provider outage still
  requires waiting and retrying; quota errors remain explicit.
- When changing to the Nomic task-prefixed embedding format, rebuild existing
  vectors once. With the app running, issue:

  ```bash
  curl --fail-with-body --request POST http://127.0.0.1:3000/api/documents/reindex
  ```

  Reindexing preserves each document's old chunks until its replacement
  embeddings are ready. If it fails partway through, rerun the request after
  resolving the reported issue.
- Retry failed indexing and remove documents, including their stored originals.
- A single RAG operation runs at a time; concurrent requests receive a
  retryable busy response.
- OCR, scanned-PDF processing, and diagram/image interpretation are not enabled
  yet. Scanned PDFs without extractable text fail with an explanatory status.
- This demo has no user authentication and is intended to remain bound to
  loopback. Do not expose it directly to a network or treat the Compose
  credentials as production secrets.

## Development checks

From `web/`:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

When changing the Drizzle schema, generate and review a migration before
applying it:

```bash
npm run db:generate
npm run db:migrate
```

`docker compose down` stops the local database while retaining its persistent
volume. Uploaded files are stored under the workspace's `data/uploads/`
directory by default and are excluded from version control.

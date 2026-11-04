"use client";

import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

type DocumentStatus = "processing" | "ready" | "partial" | "failed";
type RuntimeState = "checking" | "ready" | "offline";

type DocumentItem = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  processingStatus: DocumentStatus;
  errorSummary: string | null;
  createdAt: string;
};

type Citation = {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  contentType: string;
  excerpt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  insufficientEvidence?: boolean;
};

const maxChatMessages = 200;
const chatHistoryKey = "pagewise.chat-history.v1";
const chatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
  citations: z
    .array(
      z.object({
        chunkId: z.string().uuid(),
        documentId: z.string().uuid(),
        filename: z.string().max(255),
        pageNumber: z.number().int().positive().nullable(),
        contentType: z.string().max(40),
        excerpt: z.string().max(600),
      }),
    )
    .max(8)
    .optional(),
  insufficientEvidence: z.boolean().optional(),
});
const chatHistorySchema = z.array(chatMessageSchema).max(maxChatMessages);

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

const suggestions = [
  "Summarize the main idea in my documents",
  "What evidence supports the key recommendations?",
  "Find important dates, numbers, or constraints",
  "What questions can these documents not answer?",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case "ready":
      return "Indexed";
    case "partial":
      return "Partial";
    case "processing":
      return "Processing";
    case "failed":
      return "Failed";
  }
}

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return (
    payload?.error?.message ??
    `Request failed (${response.status}). Please try again.`
  );
}

export function ChatWorkspace() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(
    null,
  );
  const [databaseState, setDatabaseState] =
    useState<RuntimeState>("checking");
  const [ollamaState, setOllamaState] = useState<RuntimeState>("checking");
  const [geminiState, setGeminiState] = useState<RuntimeState>("checking");
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [retryingDocumentId, setRetryingDocumentId] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await responseError(response));
    }

    const data = (await response.json()) as { documents: DocumentItem[] };
    setDocuments(data.documents);
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) {
        setDatabaseState("offline");
        setOllamaState("offline");
        setGeminiState("offline");
        return;
      }

      const health = (await response.json()) as {
        database: boolean;
        ollama: boolean;
        gemini: boolean;
      };
      setDatabaseState(health.database ? "ready" : "offline");
      setOllamaState(health.ollama ? "ready" : "offline");
      setGeminiState(health.gemini ? "ready" : "offline");
    } catch {
      setDatabaseState("offline");
      setOllamaState("offline");
      setGeminiState("offline");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocuments().catch((error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not load documents.",
        );
      });
      void loadHealth();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments, loadHealth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const serialized = window.localStorage.getItem(chatHistoryKey);
        if (serialized) {
          try {
            const parsed = chatHistorySchema.safeParse(JSON.parse(serialized));
            if (parsed.success) {
              setMessages(parsed.data);
            } else {
              window.localStorage.removeItem(chatHistoryKey);
              setErrorMessage(
                "Saved chat history was invalid and has been cleared.",
              );
            }
          } catch {
            window.localStorage.removeItem(chatHistoryKey);
            setErrorMessage(
              "Saved chat history could not be read and has been cleared.",
            );
          }
        }
      } catch {
        setErrorMessage("Could not access chat history in this browser.");
      } finally {
        setHistoryLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          chatHistoryKey,
          JSON.stringify(messages.slice(-maxChatMessages)),
        );
      } catch {
        setErrorMessage(
          "Could not save chat history in this browser. Current messages may be lost on refresh.",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [historyLoaded, messages]);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (files.length === 0) {
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);

        const response = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          throw new Error(await responseError(response));
        }

        const result = (await response.json()) as {
          duplicate?: boolean;
          document?: DocumentItem;
        };
        if (result.duplicate) {
          setToast(`${file.name} is already in this collection.`);
        } else if (result.document?.processingStatus === "partial") {
          setToast(`${file.name} was indexed with partial coverage.`);
        } else {
          setToast(`${file.name} is ready to search.`);
        }
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Document upload failed.",
      );
    } finally {
      setIsUploading(false);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      await loadDocuments().catch((error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not refresh documents.",
        );
      });
      await loadHealth();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) {
      void uploadFiles(event.currentTarget.files);
    }
  };

  const removeDocument = async (document: DocumentItem) => {
    setErrorMessage("");
    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id),
      );
      setSelectedCitation((current) =>
        current?.documentId === document.id ? null : current,
      );
      setToast(`${document.originalFilename} was removed.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Document removal failed.",
      );
    }
  };

  const retryDocument = async (document: DocumentItem) => {
    setRetryingDocumentId(document.id);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/documents/${document.id}/retry`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      await loadDocuments();
      await loadHealth();
      setToast(`${document.originalFilename} was indexed.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Document retry failed.",
      );
      await loadDocuments().catch((refreshError: unknown) => {
        setErrorMessage(
          refreshError instanceof Error
            ? refreshError.message
            : "Could not refresh documents.",
        );
      });
      await loadHealth();
    } finally {
      setRetryingDocumentId(null);
    }
  };

  const askQuestion = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isAsking || !historyLoaded) {
      return;
    }

    const appendMessage = (message: ChatMessage) => {
      setMessages((current) =>
        [...current, message].slice(-maxChatMessages),
      );
    };
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedQuestion,
    };
    appendMessage(userMessage);
    setQuestion("");
    setIsAsking(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      const result = (await response.json()) as {
        answer: string;
        citations: Citation[];
        insufficientEvidence: boolean;
      };
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        insufficientEvidence: result.insufficientEvidence,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not answer that.";
      setErrorMessage(message);
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
      });
    } finally {
      setIsAsking(false);
      await loadHealth();
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setSelectedCitation(null);
    setErrorMessage("");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Document collection">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BookOpenText size={18} strokeWidth={2} />
          </div>
          <div>
            <div className="brand-name">Pagewise</div>
            <div className="brand-caption">Your documents, understood</div>
          </div>
        </div>

        <button className="new-chat-button" onClick={startNewChat} type="button">
          <Plus size={15} />
          New conversation
        </button>

        <div className="sidebar-section-heading">
          <span className="sidebar-label">Your collection</span>
          <span className="document-count">{documents.length}/10</span>
        </div>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          multiple
          onChange={handleFileChange}
          aria-label="Choose PDF or text documents"
        />
        <button
          className="upload-button"
          onClick={() => fileInput.current?.click()}
          disabled={
            isUploading ||
            isAsking ||
            retryingDocumentId !== null ||
            documents.length >= 10
          }
          type="button"
        >
          {isUploading ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Upload size={15} />
          )}
          {isUploading ? "Adding documents…" : "Add documents"}
        </button>

        <div className="document-list" aria-live="polite">
          {documents.length === 0 ? (
            <div className="sidebar-empty">
              Your collection is empty. Add a PDF or TXT file to get started.
            </div>
          ) : (
            documents.map((document) => (
              <div className="document-item" key={document.id}>
                <div className="document-icon" aria-hidden="true">
                  <FileText size={15} />
                </div>
                <div className="document-copy">
                  <div
                    className="document-name"
                    title={document.originalFilename}
                  >
                    {document.originalFilename}
                  </div>
                  <div className="document-meta">
                    <span
                      className={`status-dot ${document.processingStatus}`}
                    />
                    <span>{statusLabel(document.processingStatus)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(document.sizeBytes)}</span>
                  </div>
                  {document.errorSummary && (
                    <div className="document-error" title={document.errorSummary}>
                      {document.errorSummary}
                    </div>
                  )}
                </div>
                <div className="document-actions">
                  {document.processingStatus === "failed" && (
                    <button
                      className="document-retry"
                      type="button"
                      title={`Retry indexing ${document.originalFilename}`}
                      aria-label={`Retry indexing ${document.originalFilename}`}
                      onClick={() => void retryDocument(document)}
                      disabled={
                        isUploading ||
                        isAsking ||
                        retryingDocumentId !== null
                      }
                    >
                      {retryingDocumentId === document.id ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </button>
                  )}
                  <button
                    className="document-remove"
                    type="button"
                    title={`Remove ${document.originalFilename}`}
                    aria-label={`Remove ${document.originalFilename}`}
                    onClick={() => void removeDocument(document)}
                    disabled={retryingDocumentId === document.id}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div
            className="privacy-note"
            title="Gemini's free-tier prompts may be used to improve Google's products."
          >
            <LockKeyhole size={13} />
            Files stay local · retrieved text is sent to Google Gemini
          </div>
          <div className="runtime-status" aria-label="Service status">
            <RuntimePill name="Database" state={databaseState} />
            <RuntimePill name="Ollama embeddings" state={ollamaState} />
            <RuntimePill name="Gemini API key" state={geminiState} />
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="topbar-title">Document assistant</div>
            <div className="topbar-subtitle">
              Answers grounded in your active collection
            </div>
          </div>
          <span className="local-badge">
            <span className="status-dot" />
            Local workspace
          </span>
        </header>

        <section className="chat-area" aria-label="Conversation">
          <div className="conversation" aria-live="polite">
            {messages.length === 0 ? (
              <Welcome
                onUpload={() => fileInput.current?.click()}
                onSuggestion={(value) => {
                  setQuestion(value);
                  window.setTimeout(() => {
                    document.getElementById("question-input")?.focus();
                  }, 0);
                }}
              />
            ) : (
              messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-avatar" aria-hidden="true">
                    {message.role === "user" ? (
                      <MessageSquareText size={15} />
                    ) : (
                      <Sparkles size={15} />
                    )}
                  </div>
                  <div className="message-body">
                    <div className="message-heading">
                      {message.role === "user" ? "You" : "Pagewise"}
                      {message.insufficientEvidence && (
                        <span className="message-note"> · Evidence limited</span>
                      )}
                    </div>
                    <div className="message-text">{message.content}</div>
                    {Boolean(message.citations?.length) && (
                      <div className="citation-list" aria-label="Sources">
                        {message.citations?.map((citation, index) => (
                          <button
                            className="citation-button"
                            key={citation.chunkId}
                            onClick={() => setSelectedCitation(citation)}
                            type="button"
                          >
                            <span className="citation-number">{index + 1}</span>
                            <span className="citation-copy">
                              <span className="citation-source">
                                {citation.filename}
                                {citation.pageNumber
                                  ? ` · Page ${citation.pageNumber}`
                                  : ""}
                              </span>
                              <span className="citation-excerpt">
                                {citation.excerpt}
                              </span>
                            </span>
                            <ChevronRight className="citation-arrow" size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))
            )}
            {isAsking && (
              <div className="message assistant" role="status">
                <div className="message-avatar" aria-hidden="true">
                  <Sparkles size={15} />
                </div>
                <div className="message-body">
                  <div className="message-heading">Pagewise</div>
                  <div className="message-text loading-text">
                    Searching your evidence…
                    <LoaderCircle className="spin" size={14} />
                  </div>
                </div>
              </div>
            )}
            <div ref={conversationEnd} />
          </div>

          <div className="composer-wrap">
            {errorMessage && (
              <div className="error-banner" role="alert">
                <CircleAlert size={15} />
                <span>{errorMessage}</span>
                <button
                  className="document-remove"
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setErrorMessage("")}
                  style={{ marginLeft: "auto", opacity: 1 }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <form className="composer" onSubmit={(event) => void askQuestion(event)}>
              <button
                className="attach-button"
                onClick={() => fileInput.current?.click()}
                type="button"
                aria-label="Add a document"
                disabled={isUploading}
              >
                <Plus size={18} />
              </button>
              <label className="sr-only" htmlFor="question-input">
                Ask a question about your documents
              </label>
              <textarea
                id="question-input"
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                placeholder="Ask a question about your documents…"
                rows={1}
                maxLength={2000}
                disabled={
                  isAsking ||
                  isUploading ||
                  retryingDocumentId !== null ||
                  !historyLoaded
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void askQuestion();
                  }
                }}
              />
              <button
                className="send-button"
                type="submit"
                aria-label="Send question"
                disabled={
                  !question.trim() ||
                  isAsking ||
                  isUploading ||
                  retryingDocumentId !== null ||
                  !historyLoaded
                }
              >
                {isAsking ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowUp size={17} />
                )}
              </button>
            </form>
            <div className="composer-footnote">
              <span>Answers are based only on indexed document evidence.</span>
              <span>Enter to send · Shift + Enter for a new line</span>
            </div>
          </div>
        </section>
      </section>

      <aside className="right-panel" aria-label="Evidence panel">
        <div className="panel-heading">
          <Search size={15} />
          Evidence
        </div>
        <p className="panel-description">
          Inspect the source passage behind an answer. Every citation is
          traceable to a file in your collection.
        </p>
        {selectedCitation ? (
          <div className="evidence-card">
            <div className="evidence-file">
              <FileText size={14} />
              <span>{selectedCitation.filename}</span>
            </div>
            <div className="evidence-page">
              {selectedCitation.pageNumber
                ? `Page ${selectedCitation.pageNumber}`
                : "Text passage"}
              {" · "}
              {selectedCitation.contentType.replace("_", " ")}
            </div>
            <blockquote className="evidence-text">
              {selectedCitation.excerpt}
            </blockquote>
          </div>
        ) : (
          <div className="empty-evidence">
            <div className="empty-evidence-icon">
              <FolderOpen size={18} />
            </div>
            <strong>Evidence appears here</strong>
            <span>
              Ask a question, then select a citation to inspect its source
              passage.
            </span>
          </div>
        )}

        <hr className="panel-divider" />
        <div className="panel-heading">
          <Sparkles size={14} />
          How it works
        </div>
        <div className="how-it-works" style={{ marginTop: 16 }}>
          <div className="how-step">
            <span className="how-step-number">1</span>
            <span>Your files are read and indexed locally.</span>
          </div>
          <div className="how-step">
            <span className="how-step-number">2</span>
            <span>Relevant passages are retrieved for each question.</span>
          </div>
          <div className="how-step">
            <span className="how-step-number">3</span>
            <span>Answers cite the passages that support them.</span>
          </div>
        </div>
      </aside>

      {toast && (
        <div className="toast" role="status">
          <Check size={14} style={{ marginRight: 7, verticalAlign: "middle" }} />
          {toast}
        </div>
      )}
    </main>
  );
}

function RuntimePill({ name, state }: { name: string; state: RuntimeState }) {
  const text =
    state === "checking" ? "Checking" : state === "ready" ? "Ready" : "Offline";

  return (
    <span className={`runtime-pill ${state}`}>
      {state === "checking" ? (
        <Clock3 size={11} />
      ) : state === "ready" ? (
        <Check size={11} />
      ) : (
        <CircleAlert size={11} />
      )}
      {name} {text}
    </span>
  );
}

function Welcome({
  onUpload,
  onSuggestion,
}: {
  onUpload: () => void;
  onSuggestion: (value: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true">
        <BookOpenText size={25} strokeWidth={1.7} />
      </div>
      <div className="eyebrow">A thoughtful way to find answers</div>
      <h1>
        Ask your documents.
        <br />
        <span>See the evidence.</span>
      </h1>
      <p className="welcome-copy">
        Add a few PDFs or text files. Pagewise searches their contents and
        shows you the passages behind each answer.
      </p>
      <button
        className="welcome-upload"
        type="button"
        onClick={onUpload}
      >
        <Upload size={15} />
        Add your first document
      </button>
      <div className="suggestion-label">Try asking</div>
      <div className="suggestion-list">
        {suggestions.map((suggestion) => (
          <button
            className="suggestion-button"
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

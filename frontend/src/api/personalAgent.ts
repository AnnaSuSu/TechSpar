import {
  API_BASE,
  apiJson,
  type ApiQueryOptions,
  type ApiResponse,
} from "./client";

export interface DocumentItem {
  document_id: string;
  filename: string;
  extension: string;
  size_bytes: number;
  status: "indexing" | "needs_reindex" | "ready" | "error";
  chunk_count: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSource {
  document_id: string;
  filename: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: AgentSource[];
}

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface DocumentsResponse {
  items: DocumentItem[];
  supported_extensions: string[];
  max_upload_bytes: number;
}

interface ConversationsResponse {
  items: ConversationSummary[];
}

export interface ConversationDetail extends Omit<ConversationSummary, "message_count"> {
  message_count?: number;
  user_id?: string;
  messages: AgentMessage[];
}

type SendAgentMessageResponse = ApiResponse<"/api/personal-agent/chat", "post">;

export async function getDocuments(
  { signal }: ApiQueryOptions = {},
): Promise<DocumentsResponse> {
  return apiJson(`${API_BASE}/personal-agent/documents`, { signal });
}

export async function uploadDocument(file: File): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);
  return apiJson(`${API_BASE}/personal-agent/documents`, {
    method: "POST",
    body: form,
  });
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiJson<ApiResponse<"/api/personal-agent/documents/{document_id}", "delete">>(
    `${API_BASE}/personal-agent/documents/${documentId}`,
    { method: "DELETE" },
  );
}

export async function getConversations(
  { signal }: ApiQueryOptions = {},
): Promise<ConversationsResponse> {
  return apiJson(`${API_BASE}/personal-agent/conversations`, { signal });
}

export async function getConversation(
  conversationId: string,
  { signal }: ApiQueryOptions = {},
): Promise<ConversationDetail> {
  return apiJson(`${API_BASE}/personal-agent/conversations/${conversationId}`, { signal });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiJson<ApiResponse<"/api/personal-agent/conversations/{conversation_id}", "delete">>(
    `${API_BASE}/personal-agent/conversations/${conversationId}`,
    { method: "DELETE" },
  );
}

export async function sendAgentMessage(
  message: string,
  conversationId?: string | null,
): Promise<SendAgentMessageResponse> {
  return apiJson(`${API_BASE}/personal-agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_id: conversationId || null }),
  });
}

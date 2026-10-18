import { type DragEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  deleteConversation,
  deleteDocument,
  getConversation,
  getConversations,
  getDocuments,
  sendAgentMessage,
  uploadDocument,
  type AgentMessage,
  type ConversationSummary,
  type DocumentItem,
} from "@/api/personalAgent";

const PAGE_CLASS = "flex-1 w-full max-w-[1800px] mx-auto px-4 py-5 md:px-7 md:py-6 xl:px-8";
const ACCEPTED_DOCUMENTS = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.log,.py,.js,.jsx,.ts,.tsx,.java,.go,.rs,.sql,.css,.sh";

const MARKDOWN_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="md-table-wrapper" role="region" aria-label="Markdown 表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

function MessageMarkdown({ content }: { content: string }) {
  const messageId = useId();
  const clobberPrefix = `user-content-agent-${messageId}-`;
  const footnoteLabelId = `${clobberPrefix}footnote-label`;
  // clobberPrefix 隔离脚注及回链；上游固定的 footnote-label 和 aria-describedby 需单独隔离。
  //
  // clobberPrefix scopes footnotes and backlinks; the upstream fixed footnote-label and aria-describedby need separate scoping.
  const components = useMemo<Components>(() => ({
    ...MARKDOWN_COMPONENTS,
    h2: ({ node, ...props }) => (
      <h2 {...props} id={node?.properties.id === "footnote-label" ? footnoteLabelId : props.id} />
    ),
    a: ({ node, ...props }) => (
      <a
        {...props}
        aria-describedby={node?.properties.dataFootnoteRef ? footnoteLabelId : props["aria-describedby"]}
      />
    ),
  }), [footnoteLabelId]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      remarkRehypeOptions={{ clobberPrefix }}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

const STARTERS = [
  { icon: Brain, text: "根据我的画像，告诉我现在最该补什么" },
  { icon: BookOpen, text: "结合我的错题，帮我安排一周复习计划" },
  { icon: FileText, text: "总结我上传的资料，并指出和我当前薄弱点的关系" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

interface DocumentLibraryProps {
  documents: DocumentItem[];
  uploading: boolean;
  onChooseFile: () => void;
  onFile: (file?: File) => void;
  onRemove: (documentId: string) => void;
  headerAction?: ReactNode;
}

function DocumentLibrary({
  documents,
  uploading,
  onChooseFile,
  onFile,
  onRemove,
  headerAction,
}: DocumentLibraryProps) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    if (!uploading) onFile(event.dataTransfer.files?.[0]);
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Database className="text-primary" size={17} />
              我的资料库
              <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] font-medium text-dim">
                {documents.length}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-dim">
              Agent 会检索与你问题相关的内容
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {documents.length > 0 && (
              <Button size="sm" onClick={onChooseFile} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                上传
              </Button>
            )}
            {headerAction}
          </div>
        </div>

        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-dim">
          <span>常见文档 · 单个不超过 20 MB</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="查看支持格式"
                className="rounded-full text-dim transition-colors hover:text-text"
              >
                <CircleHelp size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[260px] leading-5">
              支持 PDF、Word、PPT、Excel、Markdown、文本、数据文件及常见代码文件。
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {documents.length === 0 && (
            <button
              type="button"
              className={cn(
                "flex w-full flex-col items-center rounded-2xl border border-dashed px-4 py-6 text-center text-dim transition-colors",
                dragging
                  ? "border-primary bg-primary/8"
                  : "border-border hover:border-primary/35 hover:bg-primary/5",
              )}
              onClick={onChooseFile}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragging(false);
              }}
              onDrop={handleDrop}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 size={20} className="mb-2 animate-spin text-primary" />
              ) : (
                <Upload size={20} className="mb-2 text-primary" />
              )}
              <span className="text-[13px] font-medium text-text">
                {uploading ? "正在上传并解析…" : "拖拽文件到这里，或点击上传"}
              </span>
              <span className="mt-1 text-[11px]">笔记、课程资料、项目文档都可以</span>
            </button>
          )}

          {documents.map((document) => (
            <div key={document.document_id} className="group rounded-xl border border-border bg-background/45 p-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-dim">
                  <FileText size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium" title={document.filename}>
                    {document.filename}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-dim">
                    <span>{formatBytes(document.size_bytes)}</span>
                    <span>·</span>
                    <span>{timeLabel(document.updated_at)}</span>
                    <span>·</span>
                    {document.status === "ready" ? (
                      <span className="text-green">已索引 {document.chunk_count} 段</span>
                    ) : document.status === "error" ? (
                      <span className="text-red" title={document.error || "解析失败"}>解析失败</span>
                    ) : document.status === "needs_reindex" ? (
                      <span className="text-orange">待重建索引</span>
                    ) : (
                      <span className="text-primary">正在索引</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="删除文档"
                  className="rounded-md p-1.5 text-dim opacity-0 transition-opacity hover:bg-red/10 hover:text-red focus:opacity-100 group-hover:opacity-100"
                  onClick={() => onRemove(document.document_id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default function PersonalAgent() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const readyCount = useMemo(
    () => documents.filter((document) => document.status === "ready").length,
    [documents],
  );

  useEffect(() => {
    Promise.all([getDocuments(), getConversations()])
      .then(([documentData, conversationData]) => {
        setDocuments(documentData.items);
        setConversations(conversationData.items);
        if (conversationData.items[0]) {
          setActiveId(conversationData.items[0].conversation_id);
          return getConversation(conversationData.items[0].conversation_id);
        }
        return null;
      })
      .then((conversation) => {
        if (conversation) setMessages(conversation.messages);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function refreshConversations(nextActiveId?: string) {
    const data = await getConversations();
    setConversations(data.items);
    if (nextActiveId) setActiveId(nextActiveId);
  }

  async function openConversation(conversationId: string) {
    if (sending) return;
    setError("");
    setActiveId(conversationId);
    try {
      const conversation = await getConversation(conversationId);
      setMessages(conversation.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载对话失败");
    }
  }

  function newConversation() {
    if (sending) return;
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError("");
  }

  async function removeConversation(conversationId: string) {
    if (!window.confirm("删除这段对话？此操作不可恢复。")) return;
    try {
      await deleteConversation(conversationId);
      const data = await getConversations();
      setConversations(data.items);
      if (activeId === conversationId) {
        const next = data.items[0];
        if (next) {
          setActiveId(next.conversation_id);
          const detail = await getConversation(next.conversation_id);
          setMessages(detail.messages);
        } else {
          newConversation();
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const document = await uploadDocument(file);
      setDocuments((current) => [document, ...current]);
      if (document.status === "error") {
        setError(document.error || "文档已保存，但没有成功建立索引");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeDocument(documentId: string) {
    if (!window.confirm("删除这个文档及其检索索引？")) return;
    try {
      await deleteDocument(documentId);
      setDocuments((current) => current.filter((document) => document.document_id !== documentId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  }

  async function submit(text = input) {
    const value = text.trim();
    if (!value || sending) return;
    const optimistic: AgentMessage = {
      role: "user",
      content: value,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setInput("");
    setSending(true);
    setError("");
    try {
      const result = await sendAgentMessage(value, activeId);
      setMessages((current) => [...current, result.message]);
      await refreshConversations(result.conversation_id);
    } catch (reason) {
      setMessages((current) => current.filter((message) => message !== optimistic));
      setInput(value);
      setError(reason instanceof Error ? reason.message : "Agent 暂时没有回复");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className={cn(PAGE_CLASS, "flex items-center justify-center text-dim")}>
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className={cn(PAGE_CLASS, "flex min-h-0 flex-col")}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-3xl font-display font-bold tracking-tight md:text-[38px]">
            <Sparkles className="text-primary" size={30} />
            成长 Agent
          </div>
          <div className="mt-1 text-sm leading-6 text-dim">
            基于你的画像、错题、训练历史和个人资料，持续认识你的学习搭档。
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-dim">
          <span className="hidden rounded-full border border-border bg-card px-3 py-1.5 xl:inline-flex">
            {readyCount} 份资料可检索
          </span>
          <Button
            variant="outline"
            size="sm"
            className="xl:hidden"
            onClick={() => setMobileLibraryOpen(true)}
          >
            <Database size={14} /> 资料库 · {readyCount}
          </Button>
          <span className="rounded-full border border-border bg-card px-3 py-1.5">
            {conversations.length} 段对话
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red/25 bg-red/8 px-4 py-2.5 text-sm text-red">
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_DOCUMENTS}
        onChange={(event) => handleUpload(event.target.files?.[0])}
      />

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          libraryOpen
            ? "xl:grid-cols-[230px_minmax(0,1fr)_340px]"
            : "xl:grid-cols-[230px_minmax(0,1fr)_52px]",
        )}
      >
        <Card className="min-h-0 overflow-hidden xl:h-[calc(100vh-155px)]">
          <CardContent className="flex h-full flex-col p-3">
            <Button variant="outline" className="mb-3 w-full" onClick={newConversation}>
              <Plus size={16} /> 新对话
            </Button>
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">
              最近对话
            </div>
            <div className="min-h-0 space-y-1 overflow-y-auto">
              {conversations.length === 0 && (
                <div className="px-2 py-8 text-center text-xs leading-5 text-dim">还没有对话记录</div>
              )}
              {conversations.map((conversation) => (
                <div
                  key={conversation.conversation_id}
                  className={cn(
                    "group flex items-center gap-1 rounded-xl transition-colors",
                    activeId === conversation.conversation_id ? "bg-primary/10" : "hover:bg-hover",
                  )}
                >
                  <button
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    onClick={() => openConversation(conversation.conversation_id)}
                  >
                    <div className="truncate text-[13px] font-medium text-text">{conversation.title}</div>
                    <div className="mt-0.5 text-[11px] text-dim">
                      {conversation.message_count} 条 · {timeLabel(conversation.updated_at)}
                    </div>
                  </button>
                  <button
                    aria-label="删除对话"
                    className="mr-1 rounded-md p-1.5 text-dim opacity-0 hover:bg-red/10 hover:text-red group-hover:opacity-100"
                    onClick={() => removeConversation(conversation.conversation_id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[620px] overflow-hidden xl:h-[calc(100vh-155px)] xl:min-h-0">
          <CardContent className="flex h-full min-h-0 flex-col p-0">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <MessageSquare size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold">{activeId ? "继续聊" : "开始一段新对话"}</div>
                <div className="text-xs text-dim">回答会自动结合与你当前问题相关的长期信息</div>
              </div>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-7">
              {messages.length === 0 ? (
                <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-orange/10 text-primary">
                    <Sparkles size={26} />
                  </div>
                  <div className="text-xl font-semibold">这次想从哪里开始？</div>
                  <div className="mt-2 max-w-lg text-sm leading-6 text-dim">
                    你可以直接提问，也可以让我根据已有画像、错题和资料主动帮你诊断。
                  </div>
                  <div className="mt-6 grid w-full gap-2 md:grid-cols-3">
                    {STARTERS.map(({ icon: Icon, text }) => (
                      <button
                        key={text}
                        className="rounded-2xl border border-border bg-background/50 p-3 text-left text-[13px] leading-5 text-dim transition-colors hover:border-primary/35 hover:bg-primary/5 hover:text-text"
                        onClick={() => submit(text)}
                      >
                        <Icon className="mb-2 text-primary" size={17} />
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-5">
                  {messages.map((message, index) => (
                    <div key={`${message.created_at}-${index}`}>
                      {message.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-[14px] leading-6 text-white shadow-sm dark:text-primary-foreground">
                            {message.content}
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                            <Sparkles size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="md-content text-[14px] leading-7 text-text">
                              <MessageMarkdown content={message.content} />
                            </div>
                            {!!message.sources?.length && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {Array.from(new Map(message.sources.map((source) => [source.document_id, source])).values()).map((source) => (
                                  <span key={source.document_id} className="inline-flex items-center gap-1 rounded-full border border-border bg-hover/60 px-2.5 py-1 text-[11px] text-dim">
                                    <FileText size={11} /> {source.filename}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {sending && (
                    <div className="flex items-center gap-3 text-sm text-dim">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                        <Loader2 className="animate-spin" size={16} />
                      </div>
                      正在结合你的长期信息思考…
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-border bg-card/95 p-3 md:p-4">
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="问点什么，或让 Agent 根据你的情况主动分析…"
                  className="min-h-[48px] max-h-32 resize-none rounded-2xl"
                  rows={1}
                  disabled={sending}
                />
                <Button
                  size="icon"
                  className="h-12 w-12 shrink-0 rounded-2xl"
                  onClick={() => submit()}
                  disabled={!input.trim() || sending}
                >
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
              </div>
              <div className="mx-auto mt-1.5 max-w-3xl px-1 text-[10px] text-dim/70">
                Enter 发送 · Shift + Enter 换行 · Agent 的判断应结合你的实际情况验证
              </div>
            </div>
          </CardContent>
        </Card>

        {libraryOpen ? (
          <Card className="hidden min-h-0 overflow-hidden xl:block xl:h-[calc(100vh-155px)]">
            <CardContent className="h-full p-3.5">
              <DocumentLibrary
                documents={documents}
                uploading={uploading}
                onChooseFile={() => fileRef.current?.click()}
                onFile={handleUpload}
                onRemove={removeDocument}
                headerAction={(
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="收起资料库"
                    onClick={() => setLibraryOpen(false)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                )}
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="hidden min-h-0 overflow-hidden xl:block xl:h-[calc(100vh-155px)]">
            <CardContent className="h-full p-1.5">
              <button
                type="button"
                aria-label="展开我的资料库"
                className="flex h-full w-full flex-col items-center gap-3 rounded-xl py-3 text-dim transition-colors hover:bg-hover hover:text-text"
                onClick={() => setLibraryOpen(true)}
              >
                <ChevronLeft size={16} />
                <Database className="text-primary" size={17} />
                <span className="text-[11px] [writing-mode:vertical-rl]">我的资料库</span>
                <span className="mt-auto rounded-full bg-hover px-1.5 py-0.5 text-[10px]">{readyCount}</span>
              </button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog.Root open={mobileLibraryOpen} onOpenChange={setMobileLibraryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(92vw,360px)] border-l border-border bg-card p-4 text-text shadow-2xl outline-none">
            <Dialog.Title className="sr-only">我的资料库</Dialog.Title>
            <Dialog.Description className="sr-only">
              上传和管理成长 Agent 可以检索的个人资料
            </Dialog.Description>
            <DocumentLibrary
              documents={documents}
              uploading={uploading}
              onChooseFile={() => fileRef.current?.click()}
              onFile={handleUpload}
              onRemove={removeDocument}
              headerAction={(
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="关闭资料库">
                    <X size={16} />
                  </Button>
                </Dialog.Close>
              )}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

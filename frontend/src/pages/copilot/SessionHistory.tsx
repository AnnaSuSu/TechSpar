import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { deleteCopilotSession, getCopilotSession, listCopilotSessions, reviewCopilotSession, type CopilotSessionDetail, type CopilotSessionSummary } from "../../api/copilot";
import useTaskStatus from "../../hooks/useTaskStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import * as Dialog from "@radix-ui/react-dialog";

function date(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function active(session: CopilotSessionSummary) { return session.status === "active" && (!Number.isFinite(Date.parse(session.updated_at)) || Date.now() - Date.parse(session.updated_at) < 120_000); }

export default function SessionHistory({ prepId, initialSessionId }: { prepId: string; initialSessionId?: string }) {
  const [sessions, setSessions] = useState<CopilotSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<CopilotSessionDetail | null>(null);
  const [removing, setRemoving] = useState<CopilotSessionSummary | null>(null);
  const { startTask } = useTaskStatus();
  const refresh = useCallback(async () => { setSessions(await listCopilotSessions(prepId)); }, [prepId]);
  useEffect(() => {
    let cancelled = false;
    listCopilotSessions(prepId).then((items) => { if (!cancelled) { setSessions(items); setError(""); } })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [prepId]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(""); setNotice("");
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请稍后重试"); }
    finally { setBusy(null); }
  };
  const review = (session: CopilotSessionSummary) => run(session.session_id, async () => {
    const result = await reviewCopilotSession(session.session_id);
    startTask(result.review_session_id, "copilot_review", "Copilot 实战复盘生成中");
    setNotice(result.created ? "实战复盘已开始，完成后可从任务通知打开。" : "已找到关联复盘，可从任务通知查看结果；失败的复盘可在历史记录中重试。");
    await refresh();
  });

  return (
    <Card className="border-border/80">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold text-lg flex items-center gap-2"><MessageSquare size={18} />实战记录</h2><p className="mt-1 text-sm text-dim">手动生成复盘后，对话将交由主模型评估，结果写入长期画像。</p></div>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run("refresh", refresh)} aria-label="刷新实战记录"><RefreshCw size={15} /></Button>
        </div>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
        {loading ? <p className="text-sm text-dim flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载记录...</p> : sessions.length === 0 ? <p className="py-5 text-sm text-dim text-center">暂无实战记录。结束面试后可在这里查看对话和生成复盘。</p> : (
          <ul className="space-y-3">
            {sessions.map((session) => {
              const ongoing = active(session);
              const canReview = session.hr_turns > 0 && session.candidate_turns > 0 && !ongoing;
              return <li key={session.session_id} className={`rounded-2xl border p-4 space-y-3 ${session.session_id === initialSessionId ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
                <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{date(session.created_at)}{session.session_id === initialSessionId && " · 本次面试"}</span><span className="text-dim">{ongoing ? "进行中" : session.review_session_id ? "已关联复盘" : "已结束"}</span></div>
                <p className="text-xs text-dim">面试官 {session.hr_turns} 句 · 本人 {session.candidate_turns} 句</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(session.session_id, async () => setDetail(await getCopilotSession(session.session_id)))}>查看对话</Button>
                  {session.review_session_id && <Button size="sm" variant="outline" asChild><Link to={`/review/${encodeURIComponent(session.review_session_id)}`}>查看复盘</Link></Button>}
                  <Button size="sm" disabled={busy !== null || (!session.review_session_id && !canReview)} onClick={() => void review(session)}>{busy === session.session_id && <Loader2 size={13} className="animate-spin mr-1" />}{session.review_session_id ? "检查复盘状态" : "生成实战复盘"}</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null || ongoing} onClick={() => setRemoving(session)}>删除记录</Button>
                </div>
                {!session.review_session_id && !ongoing && !canReview && <p className="text-xs text-dim">需要至少一段面试官提问和一段本人回答才能生成复盘。</p>}
              </li>;
            })}
          </ul>
        )}
        <p className="text-xs leading-5 text-dim">删除实战记录或准备记录会保留已生成的复盘及其对话副本。若要删除复盘，请前往历史记录。</p>
      </CardContent>
      <Dialog.Root open={detail !== null} onOpenChange={(open: boolean) => { if (!open) setDetail(null); }}>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" /><Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl rounded-2xl border border-border bg-card p-6 z-50 space-y-4">
          <div className="space-y-2"><Dialog.Title className="text-lg font-semibold">实战对话</Dialog.Title><Dialog.Description className="text-sm text-dim">{[detail?.company, detail?.position].filter(Boolean).join(" · ") || "Copilot 面试记录"}</Dialog.Description></div>
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2">
            {detail?.conversation.length === 0 && <p className="text-sm text-dim">尚无对话内容。</p>}
            {detail?.conversation.map((turn, index) => <div key={index} className={`rounded-xl p-3 ${turn.role === "candidate" ? "bg-primary/10 ml-6" : "bg-muted mr-6"}`}><p className="text-xs text-dim mb-1">{turn.role === "hr" ? "面试官" : "本人"} · {date(turn.at)}</p><p className="text-sm whitespace-pre-wrap break-words">{turn.text}</p></div>)}
          </div>
          <Dialog.Close asChild><Button variant="outline">关闭</Button></Dialog.Close>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={removing !== null} onOpenChange={(open: boolean) => { if (!open && !busy) setRemoving(null); }}>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" /><Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-6 z-50 space-y-4"><div className="space-y-2"><Dialog.Title className="text-lg font-semibold">删除这场实战记录？</Dialog.Title><Dialog.Description className="text-sm text-dim">原始对话将被删除。已生成的复盘、其中的对话副本和长期画像会保留。</Dialog.Description></div>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy !== null} onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={busy !== null} onClick={() => { if (removing) void run(removing.session_id, async () => { await deleteCopilotSession(removing.session_id); setRemoving(null); await refresh(); }); }}>确认删除</Button></div>
          {error && <p role="alert" className="text-sm text-red">{error}</p>}
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}

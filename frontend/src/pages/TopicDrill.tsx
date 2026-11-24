import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, BookOpen, Layers, Loader2, Play, Plus, Target } from "lucide-react";
import TopicCard from "../components/TopicCard";
import AddTopicDialog from "../components/AddTopicDialog";
import { getTopics, type TopicsResponse } from "../api/topics";
import { startInterview } from "../api/sessions";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import useTaskStatus from "../hooks/useTaskStatus";

export default function TopicDrill() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<TopicsResponse>({});
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const { creatingSessionMode, setCreatingSessionMode } = useTaskStatus();
  const loading = creatingSessionMode === "topic_drill";
  const topicEntries = Object.entries(topics);
  const selectedName = selectedTopic ? topics[selectedTopic]?.name || selectedTopic : "";

  useEffect(() => {
    const controller = new AbortController();
    getTopics({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setTopics(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(errorMessage(error, "加载训练领域失败"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPageLoading(false);
      });
    return () => controller.abort();
  }, [reloadNonce]);

  const handleRetry = () => {
    setPageLoading(true);
    setLoadError(null);
    setReloadNonce((n) => n + 1);
  };

  const handleTopicCreated = async (key: string) => {
    try {
      const data = await getTopics();
      setTopics(data);
      setLoadError(null);
    } catch {
      /* 列表刷新失败时保持现状 */
    }
    setSelectedTopic(key);
  };

  const handleStart = async () => {
    if (!selectedTopic) return;
    setCreatingSessionMode("topic_drill");
    try {
      const data = await startInterview("topic_drill", selectedTopic);
      navigate(`/interview/${data.session_id}`, { state: data });
    } catch (error) {
      toast.error("启动失败: " + errorMessage(error));
    } finally {
      setCreatingSessionMode(null);
    }
  };

  return (
    <PageContainer size="default" className="relative">
      <PageHeader
        icon={<Target size={21} />}
        title="专项训练"
        description="选择一个训练领域，AI 会参考该领域的核心知识和高频题目动态追问。"
        bordered
        actions={(
          <Button
            variant="outline"
            className="self-start rounded-xl"
            onClick={() => navigate("/knowledge")}
          >
            <BookOpen size={16} />
            管理训练领域
            <ArrowUpRight size={14} />
          </Button>
        )}
      />

      <section className="mt-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-primary" />
            <div>
              <h2 className="text-base font-semibold text-text">选择训练领域</h2>
              <p className="mt-0.5 text-[12px] text-dim">选择一个领域开始训练，没有合适的可以新建。</p>
            </div>
          </div>
          {!pageLoading && !loadError && topicEntries.length > 0 && (
            <span className="text-[11px] tabular-nums text-dim">共 {topicEntries.length} 个领域</span>
          )}
        </div>

        {pageLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[96px] rounded-2xl border border-border/50 bg-card/60" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState title="无法加载训练领域" message={loadError} onRetry={handleRetry} />
        ) : topicEntries.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={21} />}
            title="还没有训练领域"
            description="先创建一个领域并准备核心知识，就能选择它开始专项训练。"
            action={(
              <Button variant="gradient" onClick={() => setShowAddTopic(true)}>
                创建训练领域
              </Button>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 pb-28 sm:grid-cols-2 lg:grid-cols-3">
            {topicEntries.map(([key, info]) => (
              <TopicCard
                key={key}
                name={info.name || key}
                icon={info.icon}
                selected={selectedTopic === key}
                onClick={() => setSelectedTopic(key)}
              />
            ))}
            <button
              type="button"
              onClick={() => setShowAddTopic(true)}
              className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-border/80 bg-card/30 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:bg-card hover:shadow-lg hover:shadow-primary/5 md:gap-5 md:px-6 md:py-5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/80 text-dim transition-colors duration-300 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary md:h-14 md:w-14">
                <Plus size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-extrabold leading-snug tracking-tight text-text transition-colors duration-300 group-hover:text-primary/95 md:text-[15px]">
                  新建领域
                </div>
                <div className="mt-0.5 text-[12px] text-dim">没找到你的方向？新建一个</div>
              </div>
            </button>
          </div>
        )}
      </section>

      <AddTopicDialog
        open={showAddTopic}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      <div
        className={cn(
          "fixed bottom-6 left-[max(1rem,calc(50%-450px))] right-[max(1rem,calc(50%-450px))] z-40 transition-all duration-300 md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2",
          selectedTopic || loading
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-6 scale-95 opacity-0",
        )}
      >
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card/95 p-2.5 pl-4 shadow-2xl backdrop-blur-xl md:pl-5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-dim">本次训练领域</div>
            <div className="mt-1 truncate text-sm font-semibold text-text">{selectedName || "正在准备"}</div>
          </div>
          <Button
            variant="gradient"
            size="lg"
            className="h-12 shrink-0 rounded-xl px-6 font-semibold"
            disabled={!selectedTopic || loading}
            onClick={handleStart}
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> 正在创建...</>
            ) : (
              <><Play size={16} className="fill-current" /> 开始专项训练</>
            )}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}

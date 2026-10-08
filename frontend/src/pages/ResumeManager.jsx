import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import {
  Plus, FilePlus2, FileUp, Copy, Trash2, PenLine, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResumeStore } from "@/resume/store/useResumeStore";
import { getResumeAccount } from "@/resume/store/resumeAccount";
import { DEFAULT_TEMPLATES } from "@/resume/config";
import ResumeTemplateComponent from "@/resume/templates";
import ThemeModal from "@/resume/shared/ThemeModal";
import { generateUUID } from "@/resume/utils/uuid";
import PdfResumeSection from "./resumeManager/PdfResumeSection";
import "@/resume/styles/resume.css";
import "@/resume/styles/fonts";

const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12";

// A4 宽度按 96dpi 折算的像素值,缩略图按容器宽度等比缩放
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// 用简历真实内容渲染缩略图(移植 magic-resume 后不再依赖静态快照图)
function ResumeThumbnail({ resume }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / A4_WIDTH_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const template =
    DEFAULT_TEMPLATES.find((t) => t.id === resume.templateId) ||
    DEFAULT_TEMPLATES[0];

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-white">
      {scale > 0 && (
        <div
          className="pointer-events-none origin-top-left"
          style={{
            width: A4_WIDTH_PX,
            minHeight: A4_HEIGHT_PX,
            transform: `scale(${scale})`,
            padding: `${resume.globalSettings?.pagePadding ?? 32}px`,
          }}
        >
          <ResumeTemplateComponent data={resume} template={template} />
        </div>
      )}
    </div>
  );
}

function ResumeCard({ resume, onEdit, onDuplicate, onDelete }) {
  const template = DEFAULT_TEMPLATES.find((t) => t.id === resume.templateId);

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-shadow hover:shadow-lg">
      <button
        onClick={onEdit}
        className="relative aspect-[210/297] w-full cursor-pointer"
        aria-label={`编辑 ${resume.title}`}
      >
        <ResumeThumbnail resume={resume} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow">
            <PenLine className="h-3.5 w-3.5" /> 编辑
          </span>
        </div>
      </button>

      <div className="flex flex-col gap-1 border-t border-border p-3">
        <div className="truncate text-sm font-medium text-text">{resume.title}</div>
        <div className="flex items-center justify-between text-xs text-dim">
          <span>{template?.name || "经典"}</span>
          <span>{formatDate(resume.updatedAt)}</span>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={onEdit}>
            <PenLine className="h-3.5 w-3.5" /> 编辑
          </Button>
          <Button variant="ghost" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" /> 复制
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 gap-1 text-xs text-red hover:text-red"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ResumeManager() {
  const navigate = useNavigate();
  const resumes = useResumeStore((s) => s.resumes);
  const createResume = useResumeStore((s) => s.createResume);
  const duplicateResume = useResumeStore((s) => s.duplicateResume);
  const deleteResume = useResumeStore((s) => s.deleteResume);
  const addResume = useResumeStore((s) => s.addResume);
  const setActiveResume = useResumeStore((s) => s.setActiveResume);
  const [pendingDelete, setPendingDelete] = useState(null);
  const fileInputRef = useRef(null);

  const resumeList = useMemo(
    () =>
      Object.values(resumes).sort(
        (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
      ),
    [resumes]
  );

  const openEditor = (id) => {
    setActiveResume(id);
    navigate(`/resume-manager/${id}`);
  };

  const handleCreate = (isBlank) => {
    const id = createResume(null, isBlank);
    navigate(`/resume-manager/${id}`);
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const account = getResumeAccount();
    try {
      const data = JSON.parse(await file.text());
      if (!account || account !== getResumeAccount()) return;
      if (!data || typeof data !== "object" || !data.menuSections || !data.basic) {
        throw new Error("不是有效的简历 JSON");
      }
      const id = generateUUID();
      addResume({
        ...data,
        id,
        title: data.title || file.name.replace(/\.json$/i, ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success("导入成功");
      navigate(`/resume-manager/${id}`);
    } catch (err) {
      toast.error(`导入失败:${err.message}`);
    }
  };

  return (
    <div className={PAGE_CLASS}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">简历管理</h1>
        <p className="mt-1 text-sm text-dim">
          面试用的原始 PDF 和可编辑的模板简历,都在这里管理
        </p>
      </div>

      <PdfResumeSection />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text">模板简历</h2>
          <span className="text-xs text-dim">
            多套模板、可编辑、支持导出 PDF;数据保存在本地浏览器
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="h-4 w-4" /> 导入 JSON
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => handleCreate(true)}>
            <FilePlus2 className="h-4 w-4" /> 空白简历
          </Button>
          <Button className="gap-1.5" onClick={() => handleCreate(false)}>
            <Plus className="h-4 w-4" /> 新建简历
          </Button>
        </div>
      </div>

      {resumeList.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center">
          <FileText className="h-10 w-10 text-dim" />
          <div className="text-text font-medium">还没有简历</div>
          <p className="max-w-sm text-sm text-dim">
            从示例内容开始快速上手,或导入之前导出的简历 JSON
          </p>
          <Button className="mt-2 gap-1.5" onClick={() => handleCreate(false)}>
            <Plus className="h-4 w-4" /> 新建简历
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {resumeList.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              onEdit={() => openEditor(resume.id)}
              onDuplicate={() => {
                const newId = duplicateResume(resume.id);
                toast.success("已复制");
                openEditor(newId);
              }}
              onDelete={() => setPendingDelete(resume)}
            />
          ))}
        </div>
      )}

      <ThemeModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          deleteResume(pendingDelete);
          setPendingDelete(null);
          toast.success("已删除");
        }}
        title={pendingDelete?.title || ""}
      />

      <Toaster
        position="top-center"
        richColors
        theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
      />
    </div>
  );
}

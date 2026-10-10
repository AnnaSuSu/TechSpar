// 简历管理里的「面试简历(原生 PDF)」区块:与简历面试 / JD 备面共用同一份上传的 PDF
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Download,
  Eye,
  FileText,
  FileUp,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/resume/ui/dialog";
import ThemeModal from "@/resume/shared/ThemeModal";
import { useResumeStore } from "@/resume/store/useResumeStore";
import { getResumeAccount } from "@/resume/store/resumeAccount";
import {
  deleteUploadedResume,
  getResumePdfBlob,
  getResumeStatus,
  parseUploadedResume,
  uploadResume,
} from "../../api/interview";
import {
  buildResumeFromParsed,
  type ParsedResumePayload,
} from "./importParsed";

interface ResumeStatus {
  has_resume: boolean;
  filename?: string;
  size?: number;
}

function formatFileSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 后端错误体是 {"detail": "..."},取出来给 toast 用
function extractErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(message) as { detail?: string };
    if (parsed.detail) return parsed.detail;
  } catch {
    /* 非 JSON 原样返回 */
  }
  return message;
}

export default function PdfResumeSection() {
  const navigate = useNavigate();
  const addResume = useResumeStore((s) => s.addResume);
  const [status, setStatus] = useState<ResumeStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = (await getResumeStatus()) as ResumeStatus;
      setStatus(data);
    } catch {
      setStatus({ has_resume: false });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // 预览用的 objectURL 关闭弹窗时释放
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await uploadResume(file);
      toast.success("简历已上传");
      refreshStatus();
    } catch (err) {
      toast.error(`上传失败:${extractErrorMessage(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async () => {
    try {
      const blob = await getResumePdfBlob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      toast.error(`预览失败:${extractErrorMessage(err)}`);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await getResumePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = status?.filename || "resume.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`下载失败:${extractErrorMessage(err)}`);
    }
  };

  const handleParse = async () => {
    const account = getResumeAccount();
    setParsing(true);
    const toastId = toast.loading("正在用你的 LLM 解析简历,可能需要一分钟…");
    try {
      const result = (await parseUploadedResume()) as {
        parsed?: ParsedResumePayload;
      };
      if (!account || account !== getResumeAccount()) {
        toast.dismiss(toastId);
        return;
      }
      if (!result.parsed) throw new Error("解析结果为空");
      const fallbackTitle = (status?.filename || "导入的简历").replace(
        /\.pdf$/i,
        ""
      );
      const resume = buildResumeFromParsed(result.parsed, fallbackTitle);
      addResume(resume);
      toast.success("已解析为模板简历,进入编辑器微调吧", { id: toastId });
      navigate(`/resume-manager/${resume.id}`);
    } catch (err) {
      toast.error(`解析失败:${extractErrorMessage(err)}`, { id: toastId });
    } finally {
      setParsing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await deleteUploadedResume();
      toast.success("已删除");
      refreshStatus();
    } catch (err) {
      toast.error(`删除失败:${extractErrorMessage(err)}`);
    }
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">面试简历(PDF)</h2>
        <span className="text-xs text-dim">
          简历面试 / JD 备面用的原始简历,单份
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleUpload}
      />

      {!status ? (
        <div className="h-20 animate-pulse rounded-xl border border-border bg-card" />
      ) : status.has_resume ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-red/10">
            <FileText className="h-6 w-6 text-red" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">
              {status.filename}
            </div>
            <div className="text-xs text-dim">{formatFileSize(status.size)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={handlePreview}>
              <Eye className="h-4 w-4" /> 预览
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleDownload}>
              <Download className="h-4 w-4" /> 下载
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              替换
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={parsing}
              onClick={handleParse}
            >
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              解析为模板简历
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-red hover:text-red"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" /> 删除
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border p-4">
          <div className="text-sm text-dim">
            还没有上传 PDF 简历。上传后可用于简历面试 / JD 备面,也能一键解析成可编辑的模板简历。
          </div>
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            上传 PDF
          </Button>
        </div>
      )}

      <Dialog
        open={!!previewUrl}
        onOpenChange={(open) => {
          if (!open && previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-sm">{status?.filename}</DialogTitle>
            <DialogDescription />
          </DialogHeader>
          {previewUrl && (
            <iframe
              src={previewUrl}
              title="简历预览"
              className="h-[78vh] w-full rounded-b-lg bg-white"
            />
          )}
        </DialogContent>
      </Dialog>

      <ThemeModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title={status?.filename || ""}
      />
    </section>
  );
}

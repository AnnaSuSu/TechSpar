import { useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useResumeStore } from "@/resume/store/useResumeStore";
import ResumeWorkbenchPage from "@/resume/WorkbenchPage";
import "@/resume/styles/resume.css";
import "@/resume/styles/tiptap.css";
import "@/resume/styles/fonts";

// 工作台外壳:把路由参数同步到 store,再渲染移植过来的编辑工作台
export default function ResumeEditor() {
  const { id } = useParams();
  const resumes = useResumeStore((s) => s.resumes);
  const activeResumeId = useResumeStore((s) => s.activeResumeId);
  const setActiveResume = useResumeStore((s) => s.setActiveResume);
  const exists = !!(id && resumes[id]);

  useEffect(() => {
    if (exists && activeResumeId !== id) {
      setActiveResume(id);
    }
  }, [exists, activeResumeId, id, setActiveResume]);

  if (!exists) return <Navigate to="/resume-manager" replace />;
  if (activeResumeId !== id) return null;

  return <ResumeWorkbenchPage />;
}

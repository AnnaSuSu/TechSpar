import { getResumeAccount } from "./resumeAccount";
import { useResumeStore } from "./useResumeStore";
import { readSession } from "../../lib/authSession";
import { generateUUID } from "../utils/uuid";
import { blankResumeState } from "../config/initialResumeData";
import type { ResumeData } from "../types/resume";

const LEGACY_KEY = "resume-storage";

export function hasLegacyResumes(): boolean {
  try { return Boolean(localStorage.getItem(LEGACY_KEY)); }
  catch { return false; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// No legacy content is read into the editor until ownership is confirmed.
export function recoverLegacyResumes(account: string, ownershipConfirmed: boolean): number {
  if (!ownershipConfirmed || getResumeAccount() !== account || readSession()?.user.id !== account) {
    throw new Error("请确认这些旧简历属于当前登录账号");
  }
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  let snapshot;
  try { snapshot = JSON.parse(raw); }
  catch { throw new Error("旧简历数据损坏，原数据已保留，请先备份浏览器数据"); }
  if (!record(snapshot) || (snapshot.version !== undefined && snapshot.version !== 0) ||
      !record(snapshot.state) || !record(snapshot.state.resumes)) {
    throw new Error("无法识别旧简历格式，原数据已保留");
  }
  const resumes = { ...useResumeStore.getState().resumes };
  let recoveredId: string | null = null;
  const entries = Object.values(snapshot.state.resumes);
  for (const value of entries) {
    if (!record(value) || typeof value.id !== "string" || !value.id ||
        typeof value.title !== "string" || !record(value.basic) ||
        !Array.isArray(value.menuSections) || !record(value.globalSettings) ||
        !["education", "experience", "projects"].every((key) => Array.isArray(value[key]))) {
      throw new Error("旧简历内容不完整，原数据已保留");
    }
    let id = value.id;
    while (Object.hasOwn(resumes, id)) id = generateUUID();
    const resume = value as unknown as ResumeData;
    resumes[id] = { ...structuredClone(blankResumeState), ...resume, id,
      createdAt: resume.createdAt || new Date().toISOString(),
      updatedAt: resume.updatedAt || new Date().toISOString(),
      templateId: resume.templateId ?? null };
    recoveredId ??= id;
  }
  const activeResumeId = useResumeStore.getState().activeResumeId ?? recoveredId;
  // Persist the complete merged snapshot first. Do not use the forgiving
  // editor adapter here: recovery must report quota failure and keep the source.
  localStorage.setItem(`${LEGACY_KEY}:${encodeURIComponent(account)}`, JSON.stringify({
    state: { resumes, activeResumeId }, version: 0,
  }));
  localStorage.removeItem(LEGACY_KEY);
  useResumeStore.setState({ resumes, activeResumeId,
    activeResume: activeResumeId ? resumes[activeResumeId] : null });
  return entries.length;
}

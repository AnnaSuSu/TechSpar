import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getSettings, updateSettings, type SettingsResponse } from "@/api/settings";
import { errorMessage } from "@/lib/errorMessage";
import { SETTINGS_TABS } from "./constants";
import type { SettingsDraft, SettingsTabId } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      draft: SettingsDraft;
      isAdmin: boolean;
      platformLlm: boolean;
      lastReindexAt: string;
    };

type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

function toDraft(data: SettingsResponse): SettingsDraft {
  const { llm, embedding, services, training } = data;
  return {
    llm: {
      api_base: llm.api_base || "",
      api_key: llm.api_key || "",
      model: llm.model || "",
      compatibility: llm.compatibility || "generic",
      reasoning_effort: llm.reasoning_effort || "",
      temperature: llm.temperature ?? 0.7,
      use_platform: data.source === "platform",
    },
    embedding: {
      backend: embedding?.backend || "",
      api_base: embedding?.api_base || "",
      api_key: embedding?.api_key || "",
      api_model: embedding?.api_model || "",
      api_batch_size: embedding?.api_batch_size ?? 10,
      local_model: embedding?.local_model || "",
      local_path: embedding?.local_path || "",
    },
    services: {
      dashscope_api_key: services?.dashscope_api_key || "",
      dashscope_workspace_id: services?.dashscope_workspace_id || "",
      tavily_api_key: services?.tavily_api_key || "",
      oss_access_key_id: services?.oss_access_key_id || "",
      oss_access_key_secret: services?.oss_access_key_secret || "",
      oss_bucket: services?.oss_bucket || "",
      oss_endpoint: services?.oss_endpoint || "",
    },
    system: { allow_registration: Boolean(data.system?.allow_registration) },
    training: {
      num_questions: training.num_questions ?? 10,
      divergence: training.divergence ?? 3,
    },
  };
}

export default function useSettingsPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [indexRevision, setIndexRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function loadSettings() {
      try {
        const data = await getSettings({ signal });
        if (signal.aborted) return;
        setLoad({
          status: "ready",
          draft: toDraft(data),
          isAdmin: Boolean(data.is_admin),
          platformLlm: Boolean(data.platform?.llm),
          lastReindexAt: data.last_reindex_at || "",
        });
      } catch (error) {
        if (!signal.aborted) setLoad({ status: "error", message: errorMessage(error, "请稍后重试") });
      }
    }

    void loadSettings();
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (save.status !== "saved") return;
    const timer = window.setTimeout(() => setSave({ status: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [save]);

  function retryLoad() {
    setLoad({ status: "loading" });
    setLoadAttempt((attempt) => attempt + 1);
  }

  function updateDraft<K extends keyof SettingsDraft>(section: K, patch: Partial<SettingsDraft[K]>) {
    setLoad((current) => {
      if (current.status !== "ready") return current;
      return {
        ...current,
        draft: {
          ...current.draft,
          [section]: { ...current.draft[section], ...patch },
        },
      };
    });
  }

  async function saveSettings() {
    if (load.status !== "ready" || save.status === "saving") return;
    const { draft } = load;
    setSave({ status: "saving" });
    try {
      const result = await updateSettings({
        ...draft,
        services: { ...draft.services, dashscope_workspace_id: draft.services.dashscope_workspace_id.trim() },
      });
      if (result?.embedding_changed) setIndexRevision((revision) => revision + 1);
      setSave({ status: "saved" });
      toast.success("设置已保存");
    } catch (error) {
      const message = "保存失败：" + errorMessage(error);
      setSave({ status: "error", message });
      toast.error(message);
    }
  }

  const scrollSpy = useSettingsScrollSpy(load.status === "ready");
  return { load, save, indexRevision, retryLoad, updateDraft, saveSettings, ...scrollSpy };
}

function useSettingsScrollSpy(ready: boolean) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");
  const sectionsRef = useRef<HTMLDivElement>(null);
  const unlockTimer = useRef<number | null>(null);

  useEffect(() => {
    const container = sectionsRef.current;
    if (!ready || !container || typeof IntersectionObserver === "undefined") return;

    const sections = SETTINGS_TABS.flatMap(({ id }) => {
      const element = container.querySelector(`#settings-${id}`);
      return element ? [{ id, element }] : [];
    });
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      if (unlockTimer.current !== null) return;
      const section = sections.find(({ element }) => visible.has(element));
      if (section) setActiveTab(section.id);
    }, {
      root: container.closest("main"),
      rootMargin: "-15% 0px -55% 0px",
      threshold: 0,
    });

    for (const { element } of sections) observer.observe(element);
    return () => {
      observer.disconnect();
      if (unlockTimer.current !== null) {
        window.clearTimeout(unlockTimer.current);
        unlockTimer.current = null;
      }
    };
  }, [ready]);

  function scrollToSection(id: SettingsTabId) {
    const section = sectionsRef.current?.querySelector(`#settings-${id}`);
    if (!section) return;
    setActiveTab(id);
    if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    // Keep the clicked tab active while smooth scrolling passes other sections.
    unlockTimer.current = window.setTimeout(() => {
      unlockTimer.current = null;
    }, 700);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return { activeTab, sectionsRef, scrollToSection };
}

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Server,
  Sliders,
  Eye,
  EyeOff,
  Loader2,
  Check,
  Mic,
  Square,
  Trash2,
  Database,
  Download,
  Upload,
  AlertTriangle,
  Boxes,
  UserCog,
  RotateCw,
  KeyRound,
  Plug,
  XCircle,
} from "lucide-react";
import {
  getSettings,
  updateSettings,
  rebuildEmbeddingIndex,
  testLLMConnection,
  testEmbeddingConnection,
} from "../api/interview";
import {
  getVoiceprintStatus,
  putVoiceprintCredentials,
  enrollVoiceprint,
  deleteVoiceprintEnrollment,
} from "../api/voiceprint";
import { exportPersonalData, exportSystemData, importData } from "../api/dataMigration";
import AfdianIcon from "../components/AfdianIcon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { isDesktopApp } from "@/lib/desktop";

// 录音参数
const VP_SAMPLE_RATE = 16000;
const VP_MIN_SECONDS = 6;

// ── WAV / PCM 工具（用于声纹录音上传）──

function encodeWav(pcm16, sampleRate) {
  const dataSize = pcm16.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mergeFloat32(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function resampleToPcm16(input, inputRate, outputRate) {
  if (inputRate === outputRate) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, input.length - 1);
    const w = src - lo;
    const v = (input[lo] ?? 0) * (1 - w) + (input[hi] ?? 0) * w;
    const s = Math.max(-1, Math.min(1, v));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

const DIVERGENCE_OPTIONS = [
  { value: 1, label: "聚焦薄弱", description: "100% 针对存在弱点的知识域，适合考前专项突击" },
  { value: 2, label: "侧重薄弱", description: "约 70% 针对薄弱点，30% 拓展至新知识点" },
  { value: 3, label: "均衡", description: "薄弱环节巩固与全新知识盲区发掘各占 50%" },
  { value: 4, label: "侧重探索", description: "约 30% 回顾薄弱点，70% 探索全新知识层面" },
  { value: 5, label: "全面探索", description: "100% 探索未涉猎过的新知识领域，发掘潜在盲区" },
];

/**
 * key 来源的两个选项。
 *
 * 后端只存一个 `use_platform`：默认自己的 key 优先（填了就是想用它），
 * 勾上则显式改走部署方的共享 key，自己的 key 留着不删。
 */
const LLM_SOURCE_OPTIONS = [
  {
    value: "platform",
    platform: true,
    label: "用平台提供的 key",
    description: "不用配置，开箱即用；按账号额度计费，用完需要赞助或换成自己的 key。",
  },
  {
    value: "own",
    platform: false,
    label: "用我自己的 key",
    description: "不消耗平台额度，用量不设上限；费用直接结算在你自己的服务商那边。",
  },
];

export default function Settings() {
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [compatibility, setCompatibility] = useState("generic");
  const [temperature, setTemperature] = useState(0.7);
  // key 来源：部署方是否提供共享 key，以及用户是否显式选它
  const [platformLlm, setPlatformLlm] = useState(false);
  const [usePlatform, setUsePlatform] = useState(false);
  const [numQuestions, setNumQuestions] = useState(10);
  const [divergence, setDivergence] = useState(3);
  const [showKey, setShowKey] = useState(false);

  // 连接测试结果：null | { status: "testing" | "ok" | "fail", error? }
  const [llmTest, setLlmTest] = useState(null);
  const [embTest, setEmbTest] = useState(null);

  // Embedding 配置（每用户，hot-reload；空字段继承全局默认）
  const [embBackend, setEmbBackend] = useState("");  // "" | api | local
  const [embApiBase, setEmbApiBase] = useState("");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embApiModel, setEmbApiModel] = useState("");
  const [embApiBatchSize, setEmbApiBatchSize] = useState(10);
  const [embLocalModel, setEmbLocalModel] = useState("");
  const [embLocalPath, setEmbLocalPath] = useState("");
  const [showEmbKey, setShowEmbKey] = useState(false);

  // 可选服务密钥（每用户，对应功能开关）
  const [dashscopeKey, setDashscopeKey] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [ossKeyId, setOssKeyId] = useState("");
  const [ossKeySecret, setOssKeySecret] = useState("");
  const [ossBucket, setOssBucket] = useState("");
  const [ossEndpoint, setOssEndpoint] = useState("");
  const [showDashscope, setShowDashscope] = useState(false);
  const [showTavily, setShowTavily] = useState(false);
  const [showOssSecret, setShowOssSecret] = useState(false);

  // 账户/系统配置（全局，仅 admin 可见）
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // 重建向量索引（手动按钮；换 embedding 后弹警告提醒）
  const [needsReindex, setNeedsReindex] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [reindexError, setReindexError] = useState("");
  const [reindexProgress, setReindexProgress] = useState(null); // { completed, total, label, status }
  const [lastReindexAt, setLastReindexAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("llm");

  // 声纹识别状态
  const [vpStatus, setVpStatus] = useState({ configured: false, enrolled: false });
  const [vpSecretId, setVpSecretId] = useState("");
  const [vpSecretKey, setVpSecretKey] = useState("");
  const [vpAppId, setVpAppId] = useState("");
  const [showVpKey, setShowVpKey] = useState(false);
  const [vpBusy, setVpBusy] = useState(false);
  const [vpMessage, setVpMessage] = useState("");
  const [vpRecording, setVpRecording] = useState(false);
  const [vpRecordingSec, setVpRecordingSec] = useState(0);

  const vpStreamRef = useRef(null);
  const vpCtxRef = useRef(null);
  const vpSourceRef = useRef(null);
  const vpProcessorRef = useRef(null);
  const vpChunksRef = useRef([]);
  const vpInputRateRef = useRef(VP_SAMPLE_RATE);
  const vpTimerRef = useRef(null);

  // Section refs for scrollspy
  const llmRef = useRef(null);
  const embeddingRef = useRef(null);
  const servicesRef = useRef(null);
  const voiceprintRef = useRef(null);
  const trainingRef = useRef(null);
  const accountRef = useRef(null);
  const migrationRef = useRef(null);
  const sectionRefs = {
    llm: llmRef,
    embedding: embeddingRef,
    services: servicesRef,
    voiceprint: voiceprintRef,
    training: trainingRef,
    account: accountRef,
    migration: migrationRef,
  };
  const scrollSpyLock = useRef(false);
  const scrollSpyUnlockTimer = useRef(null);

  // 数据迁移状态
  const [exporting, setExporting] = useState(null); // null | "personal" | "system"
  const [includeSensitiveCredentials, setIncludeSensitiveCredentials] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importDbStrategy, setImportDbStrategy] = useState("skip");
  const [importOverwriteFiles, setImportOverwriteFiles] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");
  const [migrationError, setMigrationError] = useState("");
  const importFileInputRef = useRef(null);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setApiBase(data.llm.api_base || "");
        setApiKey(data.llm.api_key || "");
        setModel(data.llm.model || "");
        setCompatibility(data.llm.compatibility || "generic");
        setTemperature(data.llm.temperature ?? 0.7);
        setPlatformLlm(Boolean(data.platform?.llm));
        setUsePlatform(data.source === "platform");
        const emb = data.embedding || {};
        setEmbBackend(emb.backend || "");
        setEmbApiBase(emb.api_base || "");
        setEmbApiKey(emb.api_key || "");
        setEmbApiModel(emb.api_model || "");
        setEmbApiBatchSize(emb.api_batch_size ?? 10);
        setEmbLocalModel(emb.local_model || "");
        setEmbLocalPath(emb.local_path || "");
        const svc = data.services || {};
        setDashscopeKey(svc.dashscope_api_key || "");
        setTavilyKey(svc.tavily_api_key || "");
        setOssKeyId(svc.oss_access_key_id || "");
        setOssKeySecret(svc.oss_access_key_secret || "");
        setOssBucket(svc.oss_bucket || "");
        setOssEndpoint(svc.oss_endpoint || "");
        setAllowRegistration(Boolean(data.system?.allow_registration));
        setIsAdmin(Boolean(data.is_admin));
        setLastReindexAt(data.last_reindex_at || "");
        setNumQuestions(data.training.num_questions ?? 10);
        setDivergence(data.training.divergence ?? 3);
      })
      .catch((err) => setError("加载设置失败: " + err.message))
      .finally(() => setLoading(false));

    getVoiceprintStatus()
      .then((s) => setVpStatus(s))
      .catch(() => {});
  }, []);

  const cleanupRecorder = useCallback(() => {
    if (vpTimerRef.current != null) {
      clearInterval(vpTimerRef.current);
      vpTimerRef.current = null;
    }
    vpProcessorRef.current?.disconnect();
    vpProcessorRef.current = null;
    vpSourceRef.current?.disconnect();
    vpSourceRef.current = null;
    vpStreamRef.current?.getTracks().forEach((t) => t.stop());
    vpStreamRef.current = null;
    vpCtxRef.current?.close().catch(() => {});
    vpCtxRef.current = null;
    setVpRecording(false);
    setVpRecordingSec(0);
  }, []);

  useEffect(() => () => cleanupRecorder(), [cleanupRecorder]);

  useEffect(() => () => {
    if (scrollSpyUnlockTimer.current != null) {
      window.clearTimeout(scrollSpyUnlockTimer.current);
    }
  }, []);

  // ScrollSpy: highlight tab whose section is most prominent in the viewport
  useEffect(() => {
    if (loading) return;
    const anyEl = llmRef.current;
    if (!anyEl) return;
    const scroller = anyEl.closest("main") || null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollSpyLock.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const id = visible[0].target.getAttribute("data-tab-id");
        if (id) setActiveTab(id);
      },
      {
        root: scroller,
        rootMargin: "-15% 0px -55% 0px",
        threshold: 0,
      }
    );

    Object.values(sectionRefs).forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const handleTabClick = (id) => {
    setActiveTab(id);
    const el = sectionRefs[id]?.current;
    if (!el) return;
    // Suppress scrollspy briefly while the smooth scroll plays out
    scrollSpyLock.current = true;
    if (scrollSpyUnlockTimer.current != null) {
      window.clearTimeout(scrollSpyUnlockTimer.current);
    }
    scrollSpyUnlockTimer.current = window.setTimeout(() => {
      scrollSpyLock.current = false;
      scrollSpyUnlockTimer.current = null;
    }, 700);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handlePasswordChange = async () => {
    setPasswordMessage("");
    setPasswordError("");
    if (newPassword.length < 8) { setPasswordError("新密码至少 8 个字符"); return; }
    if (newPassword !== confirmPassword) { setPasswordError("两次输入的新密码不一致"); return; }
    setPasswordBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "修改密码失败");
      }
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordMessage("密码已更新");
    } catch (err) {
      setPasswordError(err.message || "修改密码失败");
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleSaveVpCredentials = async () => {
    setVpBusy(true);
    setVpMessage("");
    try {
      await putVoiceprintCredentials({
        secret_id: vpSecretId.trim(),
        secret_key: vpSecretKey.trim(),
        app_id: vpAppId.trim(),
      });
      const s = await getVoiceprintStatus();
      setVpStatus(s);
      setVpMessage("凭据已验证并保存");
    } catch (err) {
      setVpMessage("保存失败：" + (err.message || "未知错误"));
    } finally {
      setVpBusy(false);
    }
  };

  const startVpRecording = async () => {
    setVpMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: VP_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const ctx = new AudioContext({ sampleRate: VP_SAMPLE_RATE });
      vpInputRateRef.current = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      vpChunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        vpChunksRef.current.push(new Float32Array(ch));
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      vpStreamRef.current = stream;
      vpCtxRef.current = ctx;
      vpSourceRef.current = source;
      vpProcessorRef.current = processor;

      setVpRecording(true);
      setVpRecordingSec(0);
      const t0 = Date.now();
      vpTimerRef.current = setInterval(() => {
        setVpRecordingSec((Date.now() - t0) / 1000);
      }, 200);
    } catch (err) {
      cleanupRecorder();
      setVpMessage("麦克风访问失败：" + (err.message || "未知错误"));
    }
  };

  const stopVpRecording = async () => {
    const chunks = vpChunksRef.current;
    const inputRate = vpInputRateRef.current;
    const seconds = vpRecordingSec;
    cleanupRecorder();

    if (seconds < VP_MIN_SECONDS) {
      setVpMessage(`录音太短，至少 ${VP_MIN_SECONDS} 秒`);
      return;
    }

    setVpBusy(true);
    try {
      const merged = mergeFloat32(chunks);
      const pcm = resampleToPcm16(merged, inputRate, VP_SAMPLE_RATE);
      const wav = encodeWav(pcm, VP_SAMPLE_RATE);
      await enrollVoiceprint(wav);
      const s = await getVoiceprintStatus();
      setVpStatus(s);
      setVpMessage("声纹已注册");
    } catch (err) {
      setVpMessage("注册失败：" + (err.message || "未知错误"));
    } finally {
      setVpBusy(false);
    }
  };

  const handleDeleteEnrollment = async () => {
    setVpBusy(true);
    setVpMessage("");
    try {
      await deleteVoiceprintEnrollment();
      const s = await getVoiceprintStatus();
      setVpStatus(s);
      setVpMessage("已删除已注册声纹");
    } catch (err) {
      setVpMessage("删除失败：" + (err.message || "未知错误"));
    } finally {
      setVpBusy(false);
    }
  };

  const handleExport = async (kind) => {
    setExporting(kind);
    setMigrationError("");
    setMigrationMessage("");
    try {
      const { filename, size } = kind === "system"
        ? await exportSystemData()
        : await exportPersonalData(includeSensitiveCredentials);
      const sizeMb = (size / 1024 / 1024).toFixed(2);
      setMigrationMessage(`已下载 ${filename} (${sizeMb} MB)`);
    } catch (err) {
      setMigrationError("导出失败：" + (err.message || "未知错误"));
    } finally {
      setExporting(null);
    }
  };

  const handleImportFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setImportFile(f);
    setImportConfirming(false);
    setMigrationMessage("");
    setMigrationError("");
  };

  const handleImportClick = () => {
    if (!importFile) return;
    setImportConfirming(true);
  };

  const handleImportConfirm = async () => {
    if (!importFile) return;
    setImportBusy(true);
    setMigrationError("");
    setMigrationMessage("");
    try {
      const r = await importData(importFile, {
        dbStrategy: importDbStrategy,
        overwriteFiles: importOverwriteFiles,
      });
      setMigrationMessage(
        `已导入：数据写入/更新 ${r.db_inserted} 条，跳过 ${r.db_skipped} 条；文件复制或合并 ${r.files_copied} 个，跳过 ${r.files_skipped} 个。个人画像已与本地画像合并，练习统计已按去重后的记录重新计算。向量索引未随备份迁移，请到 Embedding 设置中重建索引。`
      );
      setImportFile(null);
      setImportConfirming(false);
      if (importFileInputRef.current) importFileInputRef.current.value = "";
    } catch (err) {
      setMigrationError("导入失败：" + (err.message || "未知错误"));
    } finally {
      setImportBusy(false);
    }
  };

  const handleTestLLM = async () => {
    setLlmTest({ status: "testing" });
    try {
      const r = await testLLMConnection({ api_base: apiBase, api_key: apiKey, model, compatibility });
      setLlmTest(r.ok ? { status: "ok" } : { status: "fail", error: r.error });
    } catch (err) {
      setLlmTest({ status: "fail", error: err.message });
    }
  };

  const handleTestEmbedding = async () => {
    setEmbTest({ status: "testing" });
    try {
      const r = await testEmbeddingConnection({
        backend: embBackend,
        api_base: embApiBase,
        api_key: embApiKey,
        api_model: embApiModel,
        local_model: embLocalModel,
        local_path: embLocalPath,
        api_batch_size: embApiBatchSize,
      });
      setEmbTest(r.ok ? { status: "ok" } : { status: "fail", error: r.error });
    } catch (err) {
      setEmbTest({ status: "fail", error: err.message });
    }
  };

  // 和后端 resolveLlmConfig 同一套判定，让用户在保存前就能看到会走哪条路。
  // "fallback" = 选了自己的 key 但还没填全，实际仍然落回平台。
  const llmSource =
    usePlatform && platformLlm ? "platform" : apiKey && model ? "user" : platformLlm ? "fallback" : "user";
  // 选了平台就把自己的那一片停掉:不只是看着灰,而是真的填不进去——
  // 禁用的输入框浏览器也不会往里自动填。
  const ownLlmDisabled = llmSource === "platform";

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await updateSettings({
        llm: { api_base: apiBase, api_key: apiKey, model, compatibility, temperature, use_platform: usePlatform },
        embedding: {
          backend: embBackend,
          api_base: embApiBase,
          api_key: embApiKey,
          api_model: embApiModel,
          api_batch_size: embApiBatchSize,
          local_model: embLocalModel,
          local_path: embLocalPath,
        },
        services: {
          dashscope_api_key: dashscopeKey,
          tavily_api_key: tavilyKey,
          oss_access_key_id: ossKeyId,
          oss_access_key_secret: ossKeySecret,
          oss_bucket: ossBucket,
          oss_endpoint: ossEndpoint,
        },
        system: { allow_registration: allowRegistration },
        training: { num_questions: numQuestions, divergence },
      });
      if (res?.embedding_changed) {
        setNeedsReindex(true);
        setReindexDone(false);
        setReindexError("");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError("保存失败: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRebuildIndex = async () => {
    setReindexing(true);
    setReindexError("");
    setReindexDone(false);
    setReindexProgress(null);
    try {
      await rebuildEmbeddingIndex({
        onProgress: (p) => setReindexProgress(p),
        onDone: (d) => {
          setNeedsReindex(false);
          setReindexProgress(null);
          setReindexDone(true);
          setLastReindexAt(d.last_rebuild_at || "");
          setTimeout(() => setReindexDone(false), 3000);
        },
        onError: (e) => setReindexError("重建失败: " + e.message),
      });
    } catch (err) {
      setReindexError("重建失败: " + err.message);
    } finally {
      setReindexing(false);
      setReindexProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-dim">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80";
  const inputClass = "h-12 rounded-2xl bg-card/90";

  // 「测试连接」按钮 + 结果，LLM / Embedding 两处复用
  // disabledHint 非空即代表按钮不可用,内容就是不可用的原因
  const renderTestRow = (test, onTest, disabledHint = "") => (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border/40 pt-5">
      <Button
        variant="outline"
        onClick={onTest}
        disabled={Boolean(disabledHint) || test?.status === "testing"}
        className="h-10 rounded-xl"
      >
        {test?.status === "testing" ? (
          <>
            <Loader2 size={15} className="mr-1.5 animate-spin" /> 测试中…
          </>
        ) : (
          <>
            <Plug size={15} className="mr-1.5" /> 测试连接
          </>
        )}
      </Button>
      {test?.status === "ok" ? (
        <span className="flex items-center gap-1.5 text-[13px] text-emerald-500">
          <Check size={15} /> 连接正常
        </span>
      ) : test?.status === "fail" ? (
        <span className="flex items-start gap-1.5 text-[13px] text-red-500">
          <XCircle size={15} className="mt-0.5 shrink-0" /> {test.error || "连接失败"}
        </span>
      ) : test?.status === "testing" ? null : (
        <span className="text-[12px] text-dim">
          {disabledHint || "用当前填写的配置发一个最小请求，验证是否可用"}
        </span>
      )}
    </div>
  );

  const TABS = [
    { id: "llm", label: "LLM 服务", icon: Server },
    { id: "embedding", label: "Embedding", icon: Boxes },
    { id: "services", label: "可选服务", icon: KeyRound },
    { id: "voiceprint", label: "声纹识别", icon: Mic },
    { id: "training", label: "训练参数", icon: Sliders },
    { id: "account", label: "账户", icon: UserCog },
    { id: "migration", label: "数据迁移", icon: Database },
  ];

  return (
    <div className="flex-1 w-full max-w-[1080px] mx-auto px-4 pt-6 pb-0 md:px-7 md:pt-8">
      <div className="mb-7">
        <div className="text-2xl md:text-[28px] font-display font-bold">设置</div>
        <div className="text-sm text-dim mt-1">配置 LLM 服务和训练参数</div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Left Tab Rail */}
        <nav className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
            {TABS.map((tab) => {
              const { id, label } = tab;
              const Icon = tab.icon;
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => handleTabClick(id)}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-300 shrink-0 lg:w-full",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-dim hover:text-text hover:bg-hover"
                  )}
                >
                  {active && (
                    <div className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary drop-shadow-[0_0_4px_currentColor] lg:block" />
                  )}
                  <Icon
                    size={16}
                    className={cn("shrink-0", active ? "text-primary" : "text-dim group-hover:text-primary")}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right Content Pane */}
        <div className="min-w-0 space-y-5">
        {/* LLM Provider */}
        <Card ref={llmRef} data-tab-id="llm" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Server size={16} className="text-primary" />
              <span className="text-base font-semibold">LLM 服务配置</span>
            </div>
            <div className="text-[13px] text-dim mb-6">
              {platformLlm
                ? "选择这个账号用谁的 key。配置只对你生效，更改后立即生效。"
                : "你自己的 LLM，仅对你生效。本部署没有共享 key，这里必须填你自己的；更改后立即生效。"}
            </div>

            {platformLlm && (
              <div className="mb-6">
                <div className="grid gap-2 sm:grid-cols-2">
                  {LLM_SOURCE_OPTIONS.map((option) => {
                    const active = usePlatform === option.platform;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setUsePlatform(option.platform)}
                        className={cn(
                          "rounded-2xl border p-3.5 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border/70 hover:bg-hover/60"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-text">{option.label}</span>
                          {active && <Check size={15} className="shrink-0 text-primary" />}
                        </div>
                        <div className="mt-1 text-[12px] leading-relaxed text-dim">{option.description}</div>
                      </button>
                    );
                  })}
                </div>
                <div
                  className={cn(
                    "mt-2.5 text-[12px] leading-relaxed",
                    llmSource === "fallback" ? "text-orange" : "text-dim/80"
                  )}
                >
                  {llmSource === "platform"
                    ? `当前用平台的 key，按额度计费；额度用完可以换成自己的 key，或者赞助提升额度。${
                        apiKey && model ? "你自己的 key 已保存，但现在没在用。" : ""
                      }`
                    : llmSource === "user"
                      ? "当前用你自己的 key，不消耗平台额度，用量和费用都算在你自己的服务商那边。"
                      : "Model 和 API Key 都填上才会切过去；在此之前仍然走平台的 key 和额度。"}
                </div>
              </div>
            )}

            <div className={cn("grid gap-4 md:grid-cols-2", ownLlmDisabled && "opacity-60")}>
              <div className="space-y-2">
                <Label className={labelClass}>API Base URL</Label>
                <Input
                  name="llm-api-base"
                  className={inputClass}
                  disabled={ownLlmDisabled}
                  placeholder="例：https://api.openai.com/v1"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                />
                <div className="text-[12px] text-dim/70">
                  {compatibility === "deepseek" ? "DeepSeek 官方 API 填 https://api.deepseek.com（不要加 /v1）" : "多数 OpenAI 兼容服务填写包含 /v1 的 Base URL。"}
                </div>
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Model</Label>
                <Input
                  name="llm-model"
                  className={inputClass}
                  disabled={ownLlmDisabled}
                  placeholder="例：gpt-4o"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>API 兼容模式</Label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/75 px-3 py-2.5 text-sm">
                  <span className="shrink-0 text-dim">请求配置</span>
                  <select
                    className="min-w-0 flex-1 bg-transparent text-right text-text outline-none disabled:cursor-not-allowed"
                    disabled={ownLlmDisabled}
                    value={compatibility}
                    onChange={(e) => setCompatibility(e.target.value)}
                  >
                    <option value="generic">通用 OpenAI 兼容</option>
                    <option value="deepseek">DeepSeek V4</option>
                  </select>
                </label>
                <div className="text-[12px] text-dim/70">
                  DeepSeek 模式只对结构化请求发送 JSON 输出和低推理参数，其他平台不会收到这些字段。
                </div>
              </div>
            </div>

            <div className={cn("grid gap-4 md:grid-cols-2 mt-4", ownLlmDisabled && "opacity-60")}>
              <div className="space-y-2">
                <Label className={labelClass}>API Key</Label>
                <div className="relative">
                  <Input
                    name="llm-api-key"
                    className={cn(inputClass, "pr-11")}
                    disabled={ownLlmDisabled}
                    masked={!showKey}
                    placeholder="sk-...（你自己的 key）"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={ownLlmDisabled}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim transition-colors enabled:hover:text-text disabled:cursor-not-allowed"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Temperature</Label>
                <Input
                  className={inputClass}
                  type="number"
                  disabled={ownLlmDisabled}
                  step={0.1}
                  min={0}
                  max={2}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            {renderTestRow(
              llmTest,
              handleTestLLM,
              ownLlmDisabled
                ? "现在用的是平台的 key，不需要测试"
                : apiKey && model
                  ? ""
                  : "填上自己的 Model 和 API Key 才能测试"
            )}
          </CardContent>
        </Card>

        {/* Embedding */}
        <Card ref={embeddingRef} data-tab-id="embedding" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Boxes size={16} className="text-primary" />
              <span className="text-base font-semibold">Embedding 模型</span>
            </div>
            <div className="text-[13px] text-dim mb-6">
              你自己的 Embedding，仅对你生效；用于题库、知识库、个人资料库和记忆的向量化，必须配置。简历会直接读取全文，不使用 Embedding。
              <span className="text-amber-500/90">更换模型后请点下方「更新向量索引」重建（会清空并重算向量，历史会话记忆向量无法恢复）。</span>
            </div>

            <div className="space-y-2.5 mb-5">
              <Label className={labelClass}>后端模式</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "", label: "自动", hint: "填了 API 走 API，否则本地" },
                  { value: "api", label: "API", hint: "OpenAI 兼容接口" },
                  { value: "local", label: "本地", hint: "HuggingFace 模型" },
                ].map((opt) => (
                  <button
                    key={opt.value || "auto"}
                    type="button"
                    onClick={() => setEmbBackend(opt.value)}
                    className={cn(
                      "px-4 py-2 rounded-xl border text-sm transition-all",
                      embBackend === opt.value
                        ? "bg-primary/12 text-primary border-primary/50 font-medium"
                        : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="text-[12px] text-dim/70 mt-1 min-h-[18px]">
                {[
                  { value: "", hint: "填了 API 字段走 API，否则走本地（兼容老配置）" },
                  { value: "api", hint: "通过 OpenAI 兼容接口请求 embedding" },
                  { value: "local", hint: "用 Transformers.js 在本机运行 ONNX 模型，首次使用会自动下载并缓存" },
                ].find((o) => o.value === embBackend)?.hint}
              </div>
            </div>

            {(embBackend === "" || embBackend === "api") && (
              <div className="space-y-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/60">API 模式</div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelClass}>API Base URL</Label>
                    <Input
                      className={inputClass}
                      placeholder="例：https://api.openai.com/v1（OpenAI 官方留空亦可）"
                      value={embApiBase}
                      onChange={(e) => setEmbApiBase(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className={labelClass}>Embedding Model</Label>
                    <Input
                      className={inputClass}
                      placeholder="例：BAAI/bge-m3"
                      value={embApiModel}
                      onChange={(e) => setEmbApiModel(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Key</Label>
                  <div className="relative">
                    <Input
                      className={cn(inputClass, "pr-11")}
                      masked={!showEmbKey}
                      placeholder="sk-..."
                      value={embApiKey}
                      onChange={(e) => setEmbApiKey(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                      onClick={() => setShowEmbKey((v) => !v)}
                    >
                      {showEmbKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>单批文本数 (Batch Size)</Label>
                  <Input
                    className={cn(inputClass, "max-w-[160px]")}
                    type="number"
                    min={1}
                    max={2048}
                    value={embApiBatchSize}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setEmbApiBatchSize(Number.isNaN(v) ? 1 : Math.min(2048, Math.max(1, v)));
                    }}
                  />
                  <div className="text-[12px] text-dim/70">
                    每次请求的文本条数上限，因服务商而异（如 DashScope 10、OpenAI 可上千）。默认 10 最稳妥，按你的服务商上限调大；超限会报 400。
                  </div>
                </div>
              </div>
            )}

            {(embBackend === "" || embBackend === "local") && (
              <div className={cn("space-y-4", embBackend === "" && "mt-6 border-t border-border/40 pt-5")}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/60">本地模式</div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelClass}>Model Name</Label>
                    <Input
                      className={inputClass}
                      placeholder="例：Xenova/bge-m3"
                      value={embLocalModel}
                      onChange={(e) => setEmbLocalModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className={labelClass}>本地路径 (可选)</Label>
                    <Input
                      className={inputClass}
                      placeholder="留空时按 model name 在线下载"
                      value={embLocalPath}
                      onChange={(e) => setEmbLocalPath(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {renderTestRow(embTest, handleTestEmbedding)}

            {needsReindex && (
              <div className="mt-6 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-[13px] text-amber-500/90">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  你更换了 Embedding 模型，旧向量已失效。点击下方按钮重建知识库 / 个人资料库 / 记忆向量；
                  在重建前，相关检索结果会暂时为空。
                </span>
              </div>
            )}

            <div className="mt-6 space-y-3 border-t border-border/40 pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleRebuildIndex}
                  disabled={reindexing}
                  className="h-10 rounded-xl"
                >
                  {reindexing ? (
                    <>
                      <Loader2 size={15} className="mr-1.5 animate-spin" /> 重建中…
                    </>
                  ) : (
                    <>
                      <RotateCw size={15} className="mr-1.5" /> 更新向量索引
                    </>
                  )}
                </Button>
                {!reindexing &&
                  (reindexDone ? (
                    <span className="flex items-center gap-1.5 text-[13px] text-emerald-500">
                      <Check size={15} /> 已重建
                    </span>
                  ) : reindexError ? (
                    <span className="text-[13px] text-red-500">{reindexError}</span>
                  ) : lastReindexAt ? (
                    <span className="text-[12px] text-dim">
                      上次更新：{lastReindexAt.replace("T", " ").slice(0, 16)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-dim">
                      更换 Embedding 模型并保存后，点此用新模型重建知识库 / 个人资料库 / 记忆向量
                    </span>
                  ))}
              </div>

              {reindexing && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px] text-dim">
                    <span className="truncate">
                      {reindexProgress
                        ? `${reindexProgress.label}${reindexProgress.status === "error" ? "（失败，已跳过）" : "…"}`
                        : "准备中…"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {reindexProgress ? `${reindexProgress.completed}/${reindexProgress.total}` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: reindexProgress?.total
                          ? `${Math.round((reindexProgress.completed / reindexProgress.total) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Optional service keys (per-user; each gates one feature) */}
        <Card ref={servicesRef} data-tab-id="services" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={16} className="text-primary" />
              <span className="text-base font-semibold">可选服务密钥</span>
            </div>
            <div className="text-[13px] text-dim mb-6">
              按需填写，各自启用对应功能；不填则该功能关闭。均为你的专属配置，仅对你生效。
            </div>

            <div className="space-y-6">
              {/* DashScope */}
              <div className="space-y-2">
                <Label className={labelClass}>DashScope API Key</Label>
                <div className="relative">
                  <Input
                    className={cn(inputClass, "pr-11")}
                    masked={!showDashscope}
                    placeholder="sk-...（语音输入 / 录音转写 / Copilot 实时识别）"
                    value={dashscopeKey}
                    onChange={(e) => setDashscopeKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                    onClick={() => setShowDashscope((v) => !v)}
                  >
                    {showDashscope ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="text-[12px] text-dim/70">阿里云百炼（DashScope）。不填则语音相关功能不可用。</div>
              </div>

              {/* Tavily */}
              <div className="space-y-2 border-t border-border/40 pt-5">
                <Label className={labelClass}>Tavily API Key</Label>
                <div className="relative">
                  <Input
                    className={cn(inputClass, "pr-11")}
                    masked={!showTavily}
                    placeholder="tvly-...（Copilot 联网搜索公司情报）"
                    value={tavilyKey}
                    onChange={(e) => setTavilyKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                    onClick={() => setShowTavily((v) => !v)}
                  >
                    {showTavily ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="text-[12px] text-dim/70">不填则 Copilot 跳过公司联网情报。</div>
              </div>

              {/* OSS */}
              <div className="space-y-4 border-t border-border/40 pt-5">
                <div>
                  <div className="text-sm font-medium">阿里云 OSS（录音复盘长音频上传）</div>
                  <div className="text-[12px] text-dim/70 mt-1">仅录音复盘上传长音频需要；答题短语音不需要。</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelClass}>Access Key Id</Label>
                    <Input className={inputClass} placeholder="LTAI..." value={ossKeyId} onChange={(e) => setOssKeyId(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className={labelClass}>Bucket</Label>
                    <Input className={inputClass} placeholder="my-bucket" value={ossBucket} onChange={(e) => setOssBucket(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelClass}>Access Key Secret</Label>
                    <div className="relative">
                      <Input
                        className={cn(inputClass, "pr-11")}
                        masked={!showOssSecret}
                        placeholder="••••••"
                        value={ossKeySecret}
                        onChange={(e) => setOssKeySecret(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                        onClick={() => setShowOssSecret((v) => !v)}
                      >
                        {showOssSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className={labelClass}>Endpoint</Label>
                    <Input className={inputClass} placeholder="oss-cn-shanghai.aliyuncs.com" value={ossEndpoint} onChange={(e) => setOssEndpoint(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Voiceprint (Optional) */}
        <Card ref={voiceprintRef} data-tab-id="voiceprint" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Mic size={16} className="text-primary" />
              <span className="text-base font-semibold">声纹识别（可选）</span>
            </div>
            <div className="text-[13px] text-dim mb-5">
              配置腾讯云 VPR 凭据并提前录入候选人声纹后，实时面试中自动识别 HR 与候选人，无需手动切换。未配置时保持手动按钮模式。
            </div>

            <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-3 mb-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80 mb-1">
                当前状态
              </div>
              <div className="text-sm">
                {vpStatus.enrolled ? (
                  <span className="text-primary">● 已注册 {vpStatus.enrolled_at ? `(${vpStatus.enrolled_at.slice(0, 10)})` : ""}</span>
                ) : vpStatus.configured ? (
                  <span className="text-dim">◐ 已配置凭据，尚未注册声纹</span>
                ) : (
                  <span className="text-dim/70">○ 未配置</span>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className={labelClass}>Secret Id</Label>
                  <Input className={inputClass} value={vpSecretId} onChange={(e) => setVpSecretId(e.target.value)} placeholder="AKID..." />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>App Id (可选)</Label>
                  <Input className={inputClass} value={vpAppId} onChange={(e) => setVpAppId(e.target.value)} placeholder="留空即可" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className={labelClass}>Secret Key</Label>
                <div className="relative">
                  <Input
                    className={cn(inputClass, "pr-11")}
                    masked={!showVpKey}
                    value={vpSecretKey}
                    onChange={(e) => setVpSecretKey(e.target.value)}
                    placeholder="腾讯云 Secret Key"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                    onClick={() => setShowVpKey((v) => !v)}
                  >
                    {showVpKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="outline"
                  disabled={vpBusy || vpRecording || !vpSecretId || !vpSecretKey}
                  onClick={handleSaveVpCredentials}
                >
                  测试并保存凭据
                </Button>
              </div>

              <div className="border-t border-border/40 pt-5 mt-2">
                <Label className={labelClass}>候选人声纹</Label>
                <div className="text-[12px] text-dim/70 mt-1 mb-3">
                  {vpRecording
                    ? `录音中：${vpRecordingSec.toFixed(1)} 秒`
                    : `建议连续说话 ≥ ${VP_MIN_SECONDS} 秒，单人、安静环境`}
                </div>
                <div className="flex flex-wrap gap-3">
                  {vpRecording ? (
                    <Button
                      variant="outline"
                      disabled={vpBusy}
                      onClick={stopVpRecording}
                      className="border-red-400/50 text-red-500 hover:bg-red-500/10"
                    >
                      <Square size={14} className="mr-1.5" />
                      结束并上传
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={vpBusy || !vpStatus.configured}
                      onClick={startVpRecording}
                    >
                      <Mic size={14} className="mr-1.5" />
                      {vpStatus.enrolled ? "重新录制" : "开始录制"}
                    </Button>
                  )}
                  {vpStatus.enrolled && !vpRecording && (
                    <Button
                      variant="outline"
                      disabled={vpBusy}
                      onClick={handleDeleteEnrollment}
                      className="border-border/60 hover:border-red-400/50 hover:text-red-500"
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      删除声纹
                    </Button>
                  )}
                </div>
              </div>

              {vpMessage && (
                <div className="text-[12px] text-dim pt-1">{vpMessage}</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Training Params */}
        <Card ref={trainingRef} data-tab-id="training" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Sliders size={16} className="text-primary" />
              <span className="text-base font-semibold">训练参数</span>
            </div>
            <div className="text-[13px] text-dim mb-6">每次开始专项训练时的默认设置</div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label className={labelClass}>每轮题目数</Label>
                <Input
                  className={cn(inputClass, "max-w-[140px]")}
                  type="number"
                  min={5}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (v >= 5 && v <= 20) setNumQuestions(v);
                    else if (e.target.value === "") setNumQuestions(5);
                  }}
                />
                <div className="text-[12px] text-dim/60">范围 5 – 20，默认 10</div>
              </div>

              <div className="space-y-2.5">
                <Label className={labelClass}>题目发散度</Label>
                <div className="flex flex-wrap gap-2">
                  {DIVERGENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDivergence(opt.value)}
                      className={cn(
                        "px-4 py-2 rounded-xl border text-sm transition-all",
                        divergence === opt.value
                          ? "bg-primary/12 text-primary border-primary/50 font-medium"
                          : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="text-[12px] text-dim/70 mt-1 min-h-[18px]">
                  {DIVERGENCE_OPTIONS.find((o) => o.value === divergence)?.description}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account / System */}
        <Card ref={accountRef} data-tab-id="account" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <UserCog size={16} className="text-primary" />
              <span className="text-base font-semibold">账户</span>
            </div>
            <div className="text-[13px] text-dim mb-5">管理当前账户凭证{isAdmin ? "和注册策略" : ""}。</div>

            {/* 下面这三个才是真的 password 框。圈进 <form> 让 Chrome 的登录表单
                启发式只在这里生效,不会跨整页去认领配置区的输入框当用户名栏。 */}
            {isDesktopApp() ? (
              <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 text-[13px] text-dim leading-6">
                桌面版使用仅保存在本机的随机凭证并自动进入，不暴露固定默认密码。
              </div>
            ) : (
              <form
                className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-4"
                onSubmit={(event) => event.preventDefault()}
              >
                <div>
                  <div className="text-sm font-medium">修改密码</div>
                  <div className="text-[12px] text-dim/70 mt-1">首次使用默认账户后请立即修改，至少 8 个字符。</div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input type="password" autoComplete="current-password" placeholder="当前密码" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                  <Input type="password" autoComplete="new-password" placeholder="新密码" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  <Input type="password" autoComplete="new-password" placeholder="再次输入新密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword} onClick={handlePasswordChange}>
                    {passwordBusy && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                    {passwordBusy ? "更新中…" : "更新密码"}
                  </Button>
                  {passwordMessage && <span className="text-[12px] text-emerald-500">{passwordMessage}</span>}
                  {passwordError && <span className="text-[12px] text-red-500">{passwordError}</span>}
                </div>
              </form>
            )}

            {isAdmin && (
            <label className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background/40 px-4 py-4 cursor-pointer select-none">
              <div className="min-w-0">
                <div className="text-sm font-medium">允许新用户注册</div>
                <div className="text-[12px] text-dim/70 mt-1 leading-5">
                  关闭后登录页隐藏注册入口，只有 DEFAULT_EMAIL/PASSWORD（或已注册账户）能登录。建议自用部署关闭。
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowRegistration}
                onClick={() => setAllowRegistration((v) => !v)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 mt-0.5",
                  allowRegistration ? "bg-primary" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200",
                    allowRegistration ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
            )}
          </CardContent>
        </Card>

        {/* Data Migration */}
        <Card ref={migrationRef} data-tab-id="migration" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Database size={16} className="text-primary" />
              <span className="text-base font-semibold">数据迁移</span>
            </div>
            <div className="text-[13px] text-dim mb-5">
              {isAdmin
                ? "每个账户都可导出或导入自己的数据；管理员还可导出整站全量备份。"
                : "导出你的画像、训练记录、简历、知识库、个人资料和成长 Agent 对话，也可以把个人备份导入当前账户。"}
            </div>

            <div className="space-y-5">
              {/* Personal export */}
              <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium mb-0.5">导出我的数据</div>
                    <div className="text-[12px] text-dim/70">
                      包含画像、训练与错题、简历、知识库、上传文档和成长 Agent 对话
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={Boolean(exporting)}
                    onClick={() => handleExport("personal")}
                  >
                    {exporting === "personal" ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : (
                      <Download size={14} className="mr-1.5" />
                    )}
                    {exporting === "personal" ? "导出中..." : "导出我的数据"}
                  </Button>
                </div>

                <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={includeSensitiveCredentials}
                    onChange={(event) => setIncludeSensitiveCredentials(event.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-[13px] text-text">包含敏感凭据</span>
                    <span className="block text-[11px] leading-5 text-dim">
                      包括 LLM / Embedding API Key、外部服务密钥和声纹凭据；默认不导出
                    </span>
                  </span>
                </label>

                <div className="text-[11px] leading-5 text-dim/80">
                  向量索引属于可重建缓存，不进入备份。导入后请重新构建索引。
                </div>
              </div>

              {/* Full-system export */}
              {isAdmin && (
              <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium mb-0.5">导出整站全量数据</div>
                    <div className="text-[12px] text-dim/70">
                      管理员专用：打包全部账户、数据库、用户文件及已保存凭据
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={Boolean(exporting)}
                    onClick={() => handleExport("system")}
                  >
                    {exporting === "system" ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : (
                      <Download size={14} className="mr-1.5" />
                    )}
                    {exporting === "system" ? "导出中..." : "导出整站数据"}
                  </Button>
                </div>
              </div>
              )}

              {/* Import */}
              <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-4">
                <div>
                  <div className="text-sm font-medium mb-0.5">从备份导入</div>
                  <div className="text-[12px] text-dim/70">仅支持单账户备份，归档数据将归到当前登录账户</div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".gz,.tgz,application/gzip,application/x-gzip"
                    onChange={handleImportFileChange}
                    className="text-[12px] text-dim file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:bg-hover"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelClass}>练习与对话记录冲突策略</Label>
                    <div className="flex gap-2">
                      {[
                        { value: "skip", label: "保留本地" },
                        { value: "overwrite", label: "用归档覆盖" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setImportDbStrategy(opt.value)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg border text-[13px] transition-all",
                            importDbStrategy === opt.value
                              ? "bg-primary/12 text-primary border-primary/50 font-medium"
                              : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className={labelClass}>文件冲突</Label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={importOverwriteFiles}
                        onChange={(e) => setImportOverwriteFiles(e.target.checked)}
                        className="accent-primary"
                      />
                      <span className="text-[13px] text-dim">用归档文件覆盖本地（个人画像始终安全合并）</span>
                    </label>
                  </div>
                </div>

                {importConfirming ? (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-400/8 px-3 py-3">
                    <div className="flex items-start gap-2 mb-2.5">
                      <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="text-[13px]">
                        将把 <span className="font-medium">{importFile?.name}</span> 合并到当前账户。
                        {importDbStrategy === "overwrite" && "当前账户内同 ID 的数据会被覆盖。"}
                        {importOverwriteFiles && "除个人画像外，其他同名用户文件会被覆盖。"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={importBusy} onClick={() => setImportConfirming(false)}>
                        取消
                      </Button>
                      <Button variant="gradient" disabled={importBusy} onClick={handleImportConfirm}>
                        {importBusy && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                        {importBusy ? "导入中..." : "确认导入"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button variant="outline" disabled={!importFile || importBusy} onClick={handleImportClick}>
                      <Upload size={14} className="mr-1.5" />
                      导入
                    </Button>
                  </div>
                )}
              </div>

              {(migrationMessage || migrationError) && (
                <div className={cn("text-[12px]", migrationError ? "text-red" : "text-dim")}>
                  {migrationError || migrationMessage}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 赞助入口。放在最后一张卡片之后:用户已经用过产品,这时候开口才不突兀。 */}
        <Card className="overflow-hidden border-border/40 bg-card/40">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <AfdianIcon size={16} className="text-primary" />
              <h2 className="text-[15px] font-semibold">支持这个项目</h2>
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-dim">
              TechSpar 社区版支持自行部署；官方网站和官方桌面端提供统一的平台服务与套餐。
              你的支持会用于模型推理、服务器和持续开发。
              <br />
              如果它帮到了你，去爱发电赞助一点，对我意义很大。
            </p>
            <a
              href="https://ifdian.net/a/techspar"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              <AfdianIcon size={15} className="text-primary" />
              去爱发电赞助
            </a>
          </CardContent>
        </Card>


        </div>
      </div>

      {/* Sticky save bar (commits LLM + training params; 声纹/数据迁移 各自保存) */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border/40 bg-background/85 px-4 py-3 backdrop-blur-md md:-mx-7 md:px-7">
        <div className="flex items-center justify-end gap-4">
          {error ? (
            <span className="text-sm text-red">{error}</span>
          ) : (
            <span className="text-[12px] text-dim/70">
              {isAdmin
                ? "保存 LLM + Embedding + 服务密钥 + 训练参数 + 账户。声纹与数据迁移各自独立保存。"
                : "保存 LLM + Embedding + 服务密钥 + 训练参数。声纹与数据迁移各自独立保存。"}
            </span>
          )}
          <Button variant="gradient" className="px-8" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
            {saving ? "保存中..." : saved ? "已保存" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

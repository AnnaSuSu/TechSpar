import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "./constants";
import type { SettingsSectionProps } from "./types";

export default function ServicesSection({ value, onChange }: SettingsSectionProps<"services">) {
  const {
    dashscope_api_key: dashscopeKey,
    dashscope_workspace_id: dashscopeWorkspace,
    tavily_api_key: tavilyKey,
    oss_access_key_id: ossKeyId,
    oss_access_key_secret: ossKeySecret,
    oss_bucket: ossBucket,
    oss_endpoint: ossEndpoint,
  } = value;
  const [showDashscope, setShowDashscope] = useState(false);
  const [showTavily, setShowTavily] = useState(false);
  const [showOssSecret, setShowOssSecret] = useState(false);

  return (
    <Card id="settings-services" data-tab-id="services" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-primary" />
          <h2 className="text-base font-semibold">可选服务密钥</h2>
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
                onChange={(e) => onChange({ dashscope_api_key: e.target.value })}
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
            <Label className={labelClass}>百炼业务空间 ID（北京）</Label>
            <Input className={inputClass} placeholder="llm-...（可选）" value={dashscopeWorkspace} onChange={(e) => onChange({ dashscope_workspace_id: e.target.value })} />
            <div className="text-[12px] text-dim/70">Copilot 使用 Qwen-Audio-3.1-ASR 实时版。填写业务空间 ID 后使用该空间的专属接口；留空使用北京公共接口。</div>
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
                onChange={(e) => onChange({ tavily_api_key: e.target.value })}
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
                <Input className={inputClass} placeholder="LTAI..." value={ossKeyId} onChange={(e) => onChange({ oss_access_key_id: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Bucket</Label>
                <Input className={inputClass} placeholder="my-bucket" value={ossBucket} onChange={(e) => onChange({ oss_bucket: e.target.value })} />
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
                    onChange={(e) => onChange({ oss_access_key_secret: e.target.value })}
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
                <Input className={inputClass} placeholder="oss-cn-shanghai.aliyuncs.com" value={ossEndpoint} onChange={(e) => onChange({ oss_endpoint: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

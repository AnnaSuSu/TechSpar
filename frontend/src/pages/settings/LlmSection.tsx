import { useState } from "react";
import { Check, Eye, EyeOff, Server } from "lucide-react";
import { testLLMConnection } from "@/api/settings";
import { errorMessage } from "@/lib/errorMessage";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { inputClass, labelClass, LLM_SOURCE_OPTIONS } from "./constants";
import ConnectionTestRow from "./ConnectionTestRow";
import type { ConnectionTestResult, SettingsSectionProps } from "./types";

interface LlmSectionProps extends SettingsSectionProps<"llm"> {
  platformLlm: boolean;
}

export default function LlmSection({ value, onChange, platformLlm }: LlmSectionProps) {
  const { api_base: apiBase, api_key: apiKey, model, compatibility, temperature, use_platform: usePlatform } = value;
  const [showKey, setShowKey] = useState(false);
  const [llmTest, setLlmTest] = useState<ConnectionTestResult | null>(null);
  const ownConfigReady = Boolean(apiKey && model);
  const ownLlmDisabled = usePlatform && platformLlm;
  const llmSource = ownLlmDisabled ? "platform" : !ownConfigReady && platformLlm ? "fallback" : "user";
  const testHint = ownLlmDisabled
    ? "现在用的是平台的 key，不需要测试"
    : ownConfigReady ? "" : "填上自己的 Model 和 API Key 才能测试";

  async function handleTestLLM() {
    setLlmTest({ status: "testing" });
    try {
      const result = await testLLMConnection({ api_base: apiBase, api_key: apiKey, model, compatibility });
      setLlmTest(result.ok ? { status: "ok" } : { status: "fail", error: result.error });
    } catch (error) {
      setLlmTest({ status: "fail", error: errorMessage(error, "连接失败") });
    }
  }

  return (
    <Card id="settings-llm" data-tab-id="llm" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Server size={16} className="text-primary" />
          <h2 className="text-base font-semibold">LLM 服务配置</h2>
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
                    onClick={() => onChange({ use_platform: option.platform })}
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
              onChange={(e) => onChange({ api_base: e.target.value })}
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
              onChange={(e) => onChange({ model: e.target.value })}
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
                onChange={(e) => onChange({
                    compatibility: e.target.value === "deepseek" ? "deepseek" : "generic",
                  })}
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
                onChange={(e) => onChange({ api_key: e.target.value })}
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
              onChange={(e) => onChange({ temperature: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>

        <ConnectionTestRow test={llmTest} onTest={handleTestLLM} disabledHint={testHint} />
      </CardContent>
    </Card>
  );
}

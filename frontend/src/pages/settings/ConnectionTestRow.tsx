import { Check, Loader2, Plug, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConnectionTestResult } from "./types";

interface ConnectionTestRowProps {
  test: ConnectionTestResult | null;
  onTest: () => void;
  disabledHint?: string;
}

export default function ConnectionTestRow({ test, onTest, disabledHint }: ConnectionTestRowProps) {
  return (
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
        <span className="flex min-w-0 items-start gap-1.5 text-[13px] text-red-500">
          <XCircle size={15} className="mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{test.error || "连接失败"}</span>
        </span>
      ) : test?.status === "testing" ? null : (
        <span className="text-[12px] text-dim">
          {disabledHint || "用当前填写的配置发一个最小请求，验证是否可用"}
        </span>
      )}
    </div>
  );
}

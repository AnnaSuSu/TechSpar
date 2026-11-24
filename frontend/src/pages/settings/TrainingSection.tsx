import { Sliders } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DIVERGENCE_OPTIONS, inputClass, labelClass } from "./constants";
import type { SettingsSectionProps } from "./types";

export default function TrainingSection({ value, onChange }: SettingsSectionProps<"training">) {
  const { num_questions: numQuestions, divergence } = value;

  return (
    <Card id="settings-training" data-tab-id="training" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Sliders size={16} className="text-primary" />
          <h2 className="text-base font-semibold">训练参数</h2>
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
                if (v >= 5 && v <= 20) onChange({ num_questions: v });
                else if (e.target.value === "") onChange({ num_questions: 5 });
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
                  onClick={() => onChange({ divergence: opt.value })}
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
  );
}

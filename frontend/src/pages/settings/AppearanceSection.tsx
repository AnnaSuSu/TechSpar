import { Moon, Sun } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import useTheme from "@/hooks/useTheme";

export default function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <Card id="settings-appearance" data-tab-id="appearance" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Sun size={16} className="text-primary" />
          <h2 className="text-base font-semibold">外观</h2>
        </div>
        <div className="text-[13px] text-dim mb-6">选择界面主题，立即生效并保存在当前设备。</div>
        <div role="group" aria-label="界面主题" className="flex flex-wrap gap-3">
          <Button variant={theme === "light" ? "default" : "outline"} aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
            <Sun size={16} /> 浅色模式
          </Button>
          <Button variant={theme === "dark" ? "default" : "outline"} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
            <Moon size={16} /> 深色模式
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

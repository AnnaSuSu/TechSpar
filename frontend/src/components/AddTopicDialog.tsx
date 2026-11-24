import { useState } from "react";
import { toast } from "sonner";
import { ICON_OPTIONS } from "../utils/topicIcons";
import { createTopic } from "../api/topics";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AddTopicDialogProps {
  open: boolean;
  onClose: () => void;
  /** 创建成功后以新领域 key 回调,随后弹窗自动关闭 */
  onCreated: (key: string) => void | Promise<void>;
}

export default function AddTopicDialog({ open, onClose, onCreated }: AddTopicDialogProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("FileText");
  const [creating, setCreating] = useState(false);

  const handleClose = () => {
    if (creating) return;
    setName("");
    setIcon("FileText");
    onClose();
  };

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const result = await createTopic(trimmed, icon);
      const key = typeof result.key === "string" ? result.key : trimmed;
      await onCreated(key);
      setName("");
      setIcon("FileText");
      onClose();
    } catch (error) {
      toast.error("添加失败: " + errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>新增训练领域</DialogTitle>
          <DialogDescription>
            创建后先补充核心知识（手写或让 AI 生成基础内容），出题会更贴合你的方向。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="add-topic-name">名称</Label>
            <Input
              id="add-topic-name"
              placeholder="Docker 容器化"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>图标</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {ICON_OPTIONS.map(({ name: iconName, Icon }) => (
                <button
                  key={iconName}
                  type="button"
                  aria-label={`选择图标 ${iconName}`}
                  aria-pressed={icon === iconName}
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer border",
                    icon === iconName
                      ? "bg-primary/20 text-primary border-primary"
                      : "bg-hover text-dim border-transparent hover:text-text",
                  )}
                  onClick={() => setIcon(iconName)}
                  title={iconName}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={creating}>取消</Button>
          <Button variant="gradient" onClick={handleAdd} disabled={!name.trim() || creating}>
            {creating ? "创建中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import useAuth from "../../hooks/useAuth";
import { getResumeAccount } from "../../resume/store/resumeAccount";
import { hasLegacyResumes, recoverLegacyResumes } from "../../resume/store/legacyResumeRecovery";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../resume/ui/dialog";

export default function LegacyResumeRecovery() {
  const { user } = useAuth();
  const [available, setAvailable] = useState(hasLegacyResumes);
  const [account, setAccount] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const refresh = () => setAvailable(hasLegacyResumes());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  if (notice) return <p role="status" className="mb-4 text-sm text-dim">{notice}</p>;
  if (!available) return null;
  return (
    <div className="mb-5 rounded-xl border border-border bg-card p-4">
      <p className="font-medium text-text">发现旧版保存在此浏览器的简历</p>
      <p className="mt-1 text-sm text-dim">旧版未记录简历所属账号。请仅在确认这些简历属于你时恢复；恢复前不会显示简历内容。</p>
      <Button variant="outline" className="mt-3" onClick={() => {
        setAccount(getResumeAccount()); setConfirmed(false); setError("");
      }}>恢复旧简历</Button>
      <Dialog open={Boolean(account)} onOpenChange={(open) => { if (!open) setAccount(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认旧简历归属</DialogTitle>
            <DialogDescription>恢复到当前账号：{user?.email || user?.name || account}。原有账号简历会保留。共享设备上的简历可能属于其他人，请勿恢复他人数据。</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            我确认旧版简历全部属于我，并同意将其保存到当前账号
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAccount(null)}>暂不恢复</Button>
            <Button disabled={!confirmed} onClick={() => {
              try {
                const count = recoverLegacyResumes(account!, confirmed);
                setAvailable(hasLegacyResumes()); setAccount(null);
                setNotice(`已恢复 ${count} 份旧简历，可继续编辑和导出。`);
              } catch (cause) {
                setError(cause instanceof Error && cause.name !== "QuotaExceededError"
                  ? cause.message : "保存失败，请释放浏览器存储空间后重试。旧简历已保留。");
              }
            }}>确认归属并恢复</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

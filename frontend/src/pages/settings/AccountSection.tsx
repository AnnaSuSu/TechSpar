import { useState, type FormEvent } from "react";
import { Loader2, UserCog } from "lucide-react";
import { changePassword } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { isDesktopApp } from "@/lib/desktop";
import { errorMessage } from "@/lib/errorMessage";

interface AccountSectionProps {
  isAdmin: boolean;
  allowRegistration: boolean;
  onRegistrationChange: (checked: boolean) => void;
}

export default function AccountSection({
  isAdmin,
  allowRegistration,
  onRegistrationChange,
}: AccountSectionProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const canSubmit = !passwordBusy && Boolean(currentPassword && newPassword && confirmPassword);

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPasswordMessage("");
    setPasswordError("");

    if (newPassword.length < 8) {
      setPasswordError("新密码至少 8 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已更新");
    } catch (error) {
      setPasswordError(errorMessage(error, "修改密码失败"));
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <Card id="settings-account" data-tab-id="account" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <UserCog size={16} className="text-primary" />
          <h2 className="text-base font-semibold">账户</h2>
        </div>
        <div className="text-[13px] text-dim mb-5">管理当前账户凭证{isAdmin ? "和注册策略" : ""}。</div>

        {/* Keep password fields in their own form so browser autofill targets this section. */}
        {isDesktopApp() ? (
          <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 text-[13px] text-dim leading-6">
            桌面版使用仅保存在本机的随机凭证并自动进入，不暴露固定默认密码。
          </div>
        ) : (
          <form
            className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-4"
            onSubmit={handlePasswordChange}
          >
            <div>
              <div className="text-sm font-medium">修改密码</div>
              <div className="text-[12px] text-dim/70 mt-1">首次使用默认账户后请立即修改，至少 8 个字符。</div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                type="password"
                autoComplete="current-password"
                aria-label="当前密码"
                placeholder="当前密码"
                disabled={passwordBusy}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <Input
                type="password"
                autoComplete="new-password"
                aria-label="新密码"
                placeholder="新密码"
                disabled={passwordBusy}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <Input
                type="password"
                autoComplete="new-password"
                aria-label="再次输入新密码"
                placeholder="再次输入新密码"
                disabled={passwordBusy}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={!canSubmit}>
                {passwordBusy && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                {passwordBusy ? "更新中…" : "更新密码"}
              </Button>
              {passwordMessage && <span role="status" className="text-[12px] text-emerald-500">{passwordMessage}</span>}
              {passwordError && <span role="alert" className="break-words text-[12px] text-red-500">{passwordError}</span>}
            </div>
          </form>
        )}

        {isAdmin && (
          <label className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background/40 px-4 py-4 cursor-pointer select-none">
            <span className="min-w-0">
              <span className="block text-sm font-medium">允许新用户注册</span>
              <span id="settings-registration-hint" className="block text-[12px] text-dim/70 mt-1 leading-5">
                关闭后登录页隐藏注册入口，只有 DEFAULT_EMAIL/PASSWORD（或已注册账户）能登录。建议自用部署关闭。
              </span>
            </span>
            <Switch
              checked={allowRegistration}
              onCheckedChange={onRegistrationChange}
              aria-label="允许新用户注册"
              aria-describedby="settings-registration-hint"
              className="mt-0.5"
            />
          </label>
        )}
      </CardContent>
    </Card>
  );
}

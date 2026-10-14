import { Button } from "@/components/ui/button";
import useAuth from "../hooks/useAuth";

export default function SessionRecovery() {
  const { verificationError, retryVerification, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">暂时无法进入工作区</h1>
        <p role="alert" className="text-sm text-dim">{verificationError} 登录信息已保留。</p>
        <div className="flex justify-center gap-3">
          <Button onClick={retryVerification}>重试</Button>
          <Button variant="outline" onClick={logout}>重新登录</Button>
        </div>
      </div>
    </div>
  );
}

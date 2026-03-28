import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Logo from "../components/Logo";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [allowReg, setAllowReg] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setAllowReg(d.allow_registration))
      .catch(() => setAllowReg(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (isRegister && password.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const body = isRegister ? { email, password, name } : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "操作失败");
      }

      const data = await res.json();
      login(data.token, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-primary/8 to-transparent rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-sm text-dim hover:text-text transition-colors mb-8 cursor-pointer"
        >
          <ArrowLeft size={16} />
          返回首页
        </button>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardHeader className="relative">
            <div className="flex items-center gap-3 mb-1">
              <Logo className="w-10 h-10 rounded-xl drop-shadow-sm" />
              <div>
                <CardTitle>{isRegister ? "创建账号" : "欢迎回来"}</CardTitle>
                <CardDescription className="mt-1">
                  {isRegister ? "注册后开始你的面试训练" : "登录继续你的面试训练"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-1.5">
                  <Label>昵称</Label>
                  <Input type="text" placeholder="你的称呼（选填）" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>邮箱</Label>
                <Input type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label>密码</Label>
                <Input type="password" placeholder={isRegister ? "至少 6 个字符" : "输入密码"} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-sm">
                  {error}
                </div>
              )}

              <Button type="submit" variant="gradient" className="w-full mt-2" disabled={loading}>
                {loading ? "处理中..." : isRegister ? "注册" : "登录"}
              </Button>
            </form>

            {allowReg && (
              <div className="mt-6 pt-5 border-t border-border text-center">
                <span className="text-sm text-dim">
                  {isRegister ? "已有账号？" : "还没有账号？"}
                </span>
                <button
                  onClick={() => { setIsRegister(!isRegister); setError(""); }}
                  className="text-sm text-primary font-medium ml-1.5 hover:underline cursor-pointer"
                >
                  {isRegister ? "去登录" : "注册"}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

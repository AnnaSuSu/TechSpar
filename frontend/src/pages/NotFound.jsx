import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center p-10 md:p-15 gap-3 min-h-[60vh]">
      <div className="text-6xl font-bold text-dim opacity-30">404</div>
      <div className="text-xl font-semibold text-text">页面不存在</div>
      <div className="text-sm text-dim">你访问的页面可能已移除或地址有误</div>
      <button
        className="mt-3 px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium"
        onClick={() => navigate("/")}
      >
        返回首页
      </button>
    </div>
  );
}

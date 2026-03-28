import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home, User, BookOpen, GitFork, Clock, Mic, BriefcaseBusiness,
  Sun, Moon, LogOut, Menu, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { path: "/", label: "首页", icon: Home },
  { path: "/profile", label: "我的画像", icon: User },
  { path: "/knowledge", label: "题库", icon: BookOpen },
  { path: "/graph", label: "图谱", icon: GitFork },
  { path: "/history", label: "历史记录", icon: Clock },
  { path: "/job-prep", label: "JD 备面", icon: BriefcaseBusiness },
  { path: "/recording", label: "录音复盘", icon: Mic },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");
  const isActive = (path) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const navItem = ({ path, label, icon: Icon }) => {
    const active = isActive(path);
    const btn = (
      <button
        onClick={() => navigate(path)}
        className={cn(
          "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] transition-all text-left group relative",
          active
            ? "bg-primary/12 text-primary font-medium"
            : "text-dim hover:text-text hover:bg-hover",
          collapsed && "justify-center px-0"
        )}
      >
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
        )}
        <Icon size={18} className={cn("shrink-0", active ? "text-primary" : "text-dim group-hover:text-text")} />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    );

    if (collapsed) {
      return (
        <Tooltip key={path} delayDuration={0}>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
        </Tooltip>
      );
    }
    return <div key={path}>{btn}</div>;
  };

  const nav = (
    <aside className={cn(
      "flex flex-col h-full border-r border-sidebar-border bg-sidebar transition-all duration-300",
      collapsed ? "w-[68px]" : "w-[240px]"
    )}>
      <div className={cn("flex items-center shrink-0 px-4 py-4", collapsed ? "justify-center" : "gap-2.5")}>
        <img src="/logo.png" alt="TechSpar" className="w-8 h-8 rounded-lg object-contain shrink-0" />
        {!collapsed && (
          <span className="text-lg font-display font-bold text-sidebar-foreground">TechSpar</span>
        )}
      </div>

      <Separator />

      <TooltipProvider delayDuration={0}>
        <nav className={cn("flex-1 flex flex-col gap-0.5 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
          {NAV_ITEMS.map(navItem)}
        </nav>

        <Separator />

        <div className={cn("py-2 space-y-0.5", collapsed ? "px-2" : "px-3")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className={cn(
                  "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] text-dim hover:text-text hover:bg-hover transition-all",
                  collapsed && "justify-center"
                )}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                {!collapsed && (theme === "dark" ? "浅色模式" : "深色模式")}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right" sideOffset={8}>{theme === "dark" ? "浅色模式" : "深色模式"}</TooltipContent>}
          </Tooltip>

          {user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  className={cn(
                    "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] text-dim hover:text-red hover:bg-red/8 transition-all",
                    collapsed && "justify-center"
                  )}
                >
                  <LogOut size={18} />
                  {!collapsed && <span className="truncate">{user.name || user.email}</span>}
                </button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right" sideOffset={8}>退出登录</TooltipContent>}
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCollapsed(c => !c)}
                className={cn(
                  "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] text-dim hover:text-text hover:bg-hover transition-all mt-1",
                  collapsed && "justify-center"
                )}
              >
                {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                {!collapsed && "收起侧栏"}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right" sideOffset={8}>展开侧栏</TooltipContent>}
          </Tooltip>
        </div>
      </TooltipProvider>
    </aside>
  );

  return (
    <>
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate("/")}>
          <img src="/logo.png" alt="TechSpar" className="w-7 h-7 rounded-lg object-contain" />
          <span className="text-base font-display font-bold text-text">TechSpar</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(o => !o)}>
          {open ? <X size={18} /> : <Menu size={18} />}
        </Button>
      </div>

      <div className="hidden md:flex shrink-0">{nav}</div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="animate-fade-in">{nav}</div>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  User, BookOpen, GitFork, Clock, Mic, BriefcaseBusiness, Brain,
  Target, FileText, Settings as SettingsIcon,
  Sun, Moon, LogOut, Menu, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Logo from "./Logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { path: "/profile", label: "我的画像", icon: User },
  { path: "/topic-drill", label: "专项训练", icon: Target },
  { path: "/resume-interview", label: "简历面试", icon: FileText },
  { path: "/job-prep", label: "JD 备面", icon: BriefcaseBusiness },
  { path: "/recording", label: "录音复盘", icon: Mic },
  { path: "/copilot", label: "面试 Copilot", icon: Brain },
  { path: "/knowledge", label: "题库", icon: BookOpen },
  { path: "/graph", label: "图谱", icon: GitFork },
  { path: "/history", label: "历史记录", icon: Clock },
  { path: "/settings", label: "设置", icon: SettingsIcon },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem("sidebar-collapsed", collapsed); }, [collapsed]);

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
          "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] transition-all duration-300 text-left group relative overflow-hidden",
          active
            ? "bg-primary/12 text-primary font-medium"
            : "text-dim hover:text-text hover:bg-hover",
          collapsed && "justify-center px-0"
        )}
      >
        {!active && <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />}
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary drop-shadow-[0_0_4px_currentColor]" />
        )}
        <Icon size={18} className={cn("shrink-0 relative z-10 transition-transform duration-300", active ? "text-primary" : "text-dim group-hover:text-primary group-hover:scale-[1.15]")} />
        {!collapsed && <span className="truncate relative z-10 transition-transform duration-300 group-hover:translate-x-1">{label}</span>}
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
      <div className={cn("flex items-center shrink-0 py-5", collapsed ? "justify-center px-4" : "px-6 gap-2.5")}>
        <Logo className="w-7 h-7 rounded-lg shrink-0 drop-shadow-sm" />
        {!collapsed && (
          <span className="text-lg font-display font-bold text-sidebar-foreground translate-y-[1px]">TechSpar</span>
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
          <Logo className="w-7 h-7 rounded-lg drop-shadow-sm" />
          <span className="text-base font-display font-bold text-text translate-y-[1px]">TechSpar</span>
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

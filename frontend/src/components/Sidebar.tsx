import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  User, BookOpen, GitFork, Clock, Mic, Brain,
  Target, FileText, FileUser, Settings as SettingsIcon,
  MessageSquare, LogOut, Menu, X, ChevronLeft, ChevronRight, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import useAuth from "../hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Logo from "./Logo";
import AfdianIcon from "./AfdianIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "画像与规划",
    items: [
      { path: "/profile", label: "我的画像", icon: User },
      { path: "/personal-agent", label: "成长 Agent", icon: Sparkles },
    ],
  },
  {
    label: "面试训练",
    items: [
      { path: "/topic-drill", label: "专项训练", icon: Target },
      { path: "/mock-interview", label: "面试训练", icon: FileText },
      { path: "/copilot", label: "面试 Copilot", icon: Brain },
      { path: "/recording", label: "录音复盘", icon: Mic },
    ],
  },
  {
    label: "资料与知识",
    items: [
      { path: "/resume-manager", label: "简历管理", icon: FileUser },
      { path: "/knowledge", label: "领域管理", icon: BookOpen },
      { path: "/graph", label: "题目图谱", icon: GitFork },
      { path: "/history", label: "历史记录", icon: Clock },
    ],
  },
  {
    label: "系统",
    items: [
      { path: "/settings", label: "设置", icon: SettingsIcon },
    ],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  const open = openPath === location.pathname;

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const renderSidebar = ({ isMobile = false }: { isMobile?: boolean } = {}) => {
    // 移动端抽屉始终展开，避免桌面端收起状态污染移动端
    const isCollapsed = isMobile ? false : collapsed;
    const footerItemClass = cn(
      "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] transition-all",
      isCollapsed ? "justify-center px-0" : "px-3",
    );

    const renderNavItem = ({ path, label, icon: Icon }: NavItem) => {
      const active = isActive(path);
      const btn = (
        <button
          type="button"
          onClick={() => {
            setOpenPath(null);
            navigate(path);
          }}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] transition-all duration-200 text-left group relative overflow-hidden",
            active
              ? "bg-primary/12 text-primary font-medium"
              : "text-dim hover:text-text hover:bg-hover",
            isCollapsed ? "justify-center px-0" : "px-3",
          )}
        >
          {!active && (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          )}
          {active && (
            <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary drop-shadow-[0_0_4px_currentColor]" />
          )}
          <Icon
            size={18}
            className={cn(
              "shrink-0 relative z-10 transition-transform duration-200",
              active ? "text-primary" : "text-dim group-hover:text-primary group-hover:scale-110",
            )}
          />
          {!isCollapsed && (
            <span className="truncate relative z-10 transition-transform duration-200 group-hover:translate-x-0.5">
              {label}
            </span>
          )}
        </button>
      );

      if (isCollapsed) {
        return (
          <Tooltip key={path} delayDuration={0}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
          </Tooltip>
        );
      }
      return <div key={path}>{btn}</div>;
    };

    return (
      <aside
        className={cn(
          "flex flex-col h-full border-r border-sidebar-border bg-sidebar transition-all duration-300",
          isCollapsed ? "w-[68px]" : "w-[240px]",
        )}
      >
        <div
          className={cn(
            "flex items-center shrink-0 py-5",
            isCollapsed ? "justify-center px-4" : "px-6 justify-between gap-2.5",
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo className="w-7 h-7 rounded-lg shrink-0 drop-shadow-sm" />
            {!isCollapsed && (
              <span className="text-lg font-display font-bold text-sidebar-foreground translate-y-[1px] truncate">
                TechSpar
              </span>
            )}
          </div>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭导航菜单"
              className="h-8 w-8 shrink-0"
              onClick={() => setOpenPath(null)}
            >
              <X size={16} />
            </Button>
          )}
        </div>

        <Separator />

        <TooltipProvider delayDuration={0}>
          <nav
            aria-label="主导航"
            className={cn(
              "flex-1 flex flex-col overflow-y-auto py-3",
              isCollapsed ? "px-2 gap-2" : "px-3 gap-3.5",
            )}
          >
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.label} className="space-y-0.5">
                {!isCollapsed ? (
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/60">
                    {group.label}
                  </div>
                ) : (
                  groupIndex > 0 && <Separator className="my-1.5 opacity-60" />
                )}
                {group.items.map(renderNavItem)}
              </div>
            ))}
          </nav>

          <Separator />

          <div className={cn("py-2 space-y-0.5", isCollapsed ? "px-2" : "px-3")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://ifdian.net/a/techspar"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="赞助 TechSpar"
                  className={cn(footerItemClass, "text-dim hover:text-primary hover:bg-hover")}
                >
                  <AfdianIcon size={18} className="shrink-0" />
                  {!isCollapsed && <span className="truncate">赞助 TechSpar</span>}
                </a>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right" sideOffset={8}>赞助 TechSpar</TooltipContent>}
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://github.com/AnnaSuSu/TechSpar/issues/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="提交反馈（在 GitHub 新建 Issue）"
                  className={cn(footerItemClass, "text-dim hover:text-text hover:bg-hover")}
                >
                  <MessageSquare size={18} className="shrink-0" />
                  {!isCollapsed && <span className="truncate">提交反馈</span>}
                </a>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>提交反馈 · 需登录 GitHub，内容公开</TooltipContent>
            </Tooltip>

            {user && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label="退出登录"
                    className={cn(footerItemClass, "text-dim hover:text-red hover:bg-red/8")}
                  >
                    <LogOut size={18} className="shrink-0" />
                    {!isCollapsed && <span className="truncate">{user.name || user.email}</span>}
                  </button>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" sideOffset={8}>退出登录</TooltipContent>}
              </Tooltip>
            )}

            {!isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={isCollapsed ? "展开侧栏" : "收起侧栏"}
                    className={cn(footerItemClass, "text-dim hover:text-text hover:bg-hover mt-1")}
                  >
                    {isCollapsed ? <ChevronRight size={18} className="shrink-0" /> : <ChevronLeft size={18} className="shrink-0" />}
                    {!isCollapsed && <span className="truncate">收起侧栏</span>}
                  </button>
                </TooltipTrigger>
                {isCollapsed && <TooltipContent side="right" sideOffset={8}>展开侧栏</TooltipContent>}
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </aside>
    );
  };

  return (
    <>
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border shrink-0">
        <button
          type="button"
          className="flex items-center gap-2.5 text-left"
          onClick={() => {
            setOpenPath(null);
            navigate("/");
          }}
        >
          <Logo className="w-7 h-7 rounded-lg drop-shadow-sm" />
          <span className="text-base font-display font-bold text-text translate-y-[1px]">TechSpar</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
          aria-expanded={open}
          onClick={() => setOpenPath(open ? null : location.pathname)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </Button>
      </div>

      <div className="hidden md:flex shrink-0">{renderSidebar({ isMobile: false })}</div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true" aria-label="导航菜单">
          <div className="animate-fade-in h-full">{renderSidebar({ isMobile: true })}</div>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setOpenPath(null)} />
        </div>
      )}
    </>
  );
}

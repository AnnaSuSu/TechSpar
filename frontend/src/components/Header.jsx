import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { path: "/", label: "首页" },
  { path: "/profile", label: "我的画像" },
  { path: "/knowledge", label: "题库" },
  { path: "/history", label: "历史记录" },
];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");
  const isActive = (path) => location.pathname === path;

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border bg-card relative">
      {/* Logo */}
      <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate("/")}>
        <img src="/logo.png" alt="TechSpar" className="w-8 h-8 rounded-lg object-contain" />
        <span className="text-lg font-semibold text-text">TechSpar</span>
      </div>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-2">
        {NAV_ITEMS.map(({ path, label }) => (
          <button
            key={path}
            className={`px-4 py-1.5 rounded-lg text-sm transition-all ${
              isActive(path) ? "bg-hover text-text" : "bg-transparent text-dim hover:text-text hover:bg-hover"
            }`}
            onClick={() => navigate(path)}
          >
            {label}
          </button>
        ))}
        <button
          className="w-9 h-9 rounded-lg bg-hover border border-border flex items-center justify-center text-lg ml-2 transition-all"
          onClick={toggleTheme}
          title={theme === "dark" ? "切换亮色" : "切换暗色"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </nav>

      {/* Mobile: theme + hamburger */}
      <div className="flex md:hidden items-center gap-2">
        <button
          className="w-9 h-9 rounded-lg bg-hover border border-border flex items-center justify-center text-lg transition-all"
          onClick={toggleTheme}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          className="w-9 h-9 rounded-lg bg-hover border border-border flex items-center justify-center transition-all"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="菜单"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {menuOpen ? (
              <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
            ) : (
              <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <nav className="absolute top-full left-0 right-0 bg-card border-b border-border flex flex-col py-2 z-50 md:hidden animate-fade-in">
          {NAV_ITEMS.map(({ path, label }) => (
            <button
              key={path}
              className={`px-6 py-3 text-left text-sm transition-all ${
                isActive(path) ? "bg-hover text-text font-medium" : "text-dim hover:bg-hover hover:text-text"
              }`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

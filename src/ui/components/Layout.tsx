import { Outlet, NavLink } from "react-router-dom";
import { Plus, History, Settings, Music, BarChart3 } from "lucide-react";
import SidebarUsage from "./SidebarUsage";
import { useUsageWebSocket } from "../hooks/useUsageWebSocket";
import { useTheme } from "../hooks/useTheme";

const links = [
  { to: "/new", label: "New Project", icon: Plus },
  { to: "/history", label: "History", icon: History },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  // Global WebSocket listener — invalidates usage query cache on live updates
  useUsageWebSocket();
  // Apply theme from config to DOM
  useTheme();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className="w-56 flex flex-col relative"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        {/* Right edge gradient separator */}
        <div
          className="absolute right-0 top-0 bottom-0 w-px"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(139,92,246,0.2) 30%, rgba(139,92,246,0.2) 70%, transparent 100%)",
          }}
        />

        {/* Logo section */}
        <div className="px-4 py-5 flex items-center gap-2.5">
          <Music
            className="w-5 h-5 text-violet-400"
            style={{ filter: "drop-shadow(0 0 6px rgba(139,92,246,0.5))" }}
          />
          <span className="gradient-text font-bold text-lg tracking-tight">
            Orchestra AI
          </span>
        </div>

        {/* Separator below logo */}
        <div className="sidebar-separator" />

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm relative transition-all duration-200 ${
                  isActive
                    ? "text-violet-700 dark:text-violet-200"
                    : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background: "rgba(139,92,246,0.08)",
                      borderLeft: "2px solid rgba(139,92,246,0.7)",
                      marginLeft: "-2px",
                    }
                  : undefined
              }
            >
              <Icon className="w-4 h-4 transition-colors duration-200" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Usage widget in a glass container */}
        <div
          className="mx-3 mb-3 rounded-xl p-px"
          style={{
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <SidebarUsage />
        </div>

        {/* Version footer */}
        <div className="sidebar-separator" />
        <div className="px-4 py-2.5 text-[10px] text-neutral-400 dark:text-neutral-600 tracking-wide">
          Orchestra AI v0.1.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

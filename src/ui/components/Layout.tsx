import { useEffect, useRef, useState, useCallback } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { Plus, History, Settings, BarChart3 } from "lucide-react";
import SidebarUsage from "./SidebarUsage";
import { useUsageWebSocket } from "../hooks/useUsageWebSocket";
import { useTheme } from "../hooks/useTheme";
import { useStaggerReveal } from "../hooks/useAnime";

const links = [
  { to: "/new", label: "New Project", icon: Plus },
  { to: "/history", label: "History", icon: History },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const NOTES = ["♪", "♫", "♬", "♩"];

export default function Layout() {
  useUsageWebSocket();
  useTheme();
  const navRef = useStaggerReveal<HTMLElement>([], { delay: 100, stagger: 50, translateY: 10 });

  // Logo animation
  const noteRef = useRef<HTMLSpanElement | null>(null);
  const glowRef = useRef<HTMLSpanElement | null>(null);
  const [particles, setParticles] = useState<Array<{ id: number; symbol: string; x: number; dir: number }>>([]);
  const pidRef = useRef(0);

  const spawnNote = useCallback(() => {
    const id = pidRef.current++;
    const symbol = NOTES[id % NOTES.length];
    const x = 20 + Math.random() * 16;
    const dir = Math.random() > 0.5 ? 1 : -1;
    setParticles((p) => [...p.slice(-4), { id, symbol, x, dir }]);
    setTimeout(() => setParticles((p) => p.filter((n) => n.id !== id)), 2200);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { animate } = await import("animejs");
      if (cancelled) return;

      // Note icon — smooth conductor arc (like waving a baton)
      if (noteRef.current) {
        animate(noteRef.current, {
          rotate: [{ to: -12, duration: 800, easing: "easeInOutQuad" },
                   { to: 8, duration: 1000, easing: "easeInOutSine" },
                   { to: -4, duration: 600, easing: "easeInOutQuad" },
                   { to: 0, duration: 800, easing: "easeOutCubic" }],
          scale: [{ to: 1.12, duration: 1200, easing: "easeInOutSine" },
                  { to: 0.95, duration: 800, easing: "easeInOutSine" },
                  { to: 1, duration: 1200, easing: "easeOutCubic" }],
          loop: true,
        });
      }

      // Text glow — breathing scale + opacity pulse
      if (glowRef.current) {
        animate(glowRef.current, {
          scale: [1, 1.03, 1],
          opacity: [1, 0.85, 1],
          duration: 3000,
          easing: "easeInOutSine",
          loop: true,
        });
      }

      // Spawn notes frequently — 2 notes close together, then pause
      const burst = () => {
        if (cancelled) return;
        spawnNote();
        setTimeout(() => { if (!cancelled) spawnNote(); }, 600);
      };
      setTimeout(() => { if (!cancelled) burst(); }, 800);
      const iv = setInterval(() => { if (!cancelled) burst(); }, 2800);
      return () => clearInterval(iv);
    })();

    return () => { cancelled = true; };
  }, [spawnNote]);

  return (
    <div className="flex h-screen">
      <aside
        className="w-56 flex flex-col relative"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        <div
          className="absolute right-0 top-0 bottom-0 w-px"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(139,92,246,0.2) 30%, rgba(139,92,246,0.2) 70%, transparent 100%)",
          }}
        />

        {/* Logo */}
        <div className="px-4 py-5 flex items-center gap-2.5 relative">
          <span
            ref={noteRef}
            className="inline-flex items-center justify-center shrink-0"
            style={{ transformOrigin: "50% 60%", width: 22, height: 22 }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400" style={{ filter: "drop-shadow(0 0 6px rgba(139,92,246,0.5))" }}>
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </span>

          {/* Floating note particles */}
          {particles.map((p) => (
            <FloatingNote key={p.id} symbol={p.symbol} startX={p.x} dir={p.dir} />
          ))}

          <span ref={glowRef} className="gradient-text font-bold text-lg tracking-tight" style={{ transformOrigin: "left center" }}>
            Orchestra AI
          </span>
        </div>

        <div className="sidebar-separator" />

        <nav ref={navRef} className="flex-1 px-3 py-4 space-y-0.5">
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

        <div className="sidebar-separator" />
        <div className="px-4 py-2.5 text-[10px] text-neutral-400 dark:text-neutral-600 tracking-wide">
          Orchestra AI v0.4.0
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function FloatingNote({ symbol, startX, dir }: { symbol: string; startX: number; dir: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    (async () => {
      const { animate } = await import("animejs");
      if (cancelled) return;
      animate(el, {
        opacity: [0, 1, 0.8, 0],
        translateY: [6, -22],
        translateX: [0, dir * (8 + Math.random() * 12)],
        scale: [0.6, 1.1, 0.7],
        rotate: [0, dir * 18],
        duration: 1800,
        easing: "easeOutCubic",
      });
    })();

    return () => { cancelled = true; };
  }, [dir]);

  return (
    <span
      ref={ref}
      className="absolute pointer-events-none select-none"
      style={{
        top: 10,
        left: startX,
        fontSize: 13,
        opacity: 0,
        color: "rgba(167,139,250,0.9)",
        textShadow: "0 0 6px rgba(139,92,246,0.6)",
      }}
    >
      {symbol}
    </span>
  );
}

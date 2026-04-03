"use client";

import { usePathname, useRouter } from "next/navigation";

const tabs = [
  { name: "Brief", path: "/briefing", icon: BriefIcon },
  { name: "Trades", path: "/trades", icon: TradesIcon },
  { name: "Portfolio", path: "/portfolio", icon: PortfolioIcon },
  { name: "Stats", path: "/performance", icon: StatsIcon },
  { name: "Training", path: "/training", icon: TrainingIcon },
  { name: "Settings", path: "/settings", icon: SettingsIcon },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="fixed bottom-0 left-0 right-0 glass-heavy border-t border-ios-separator z-50 tab-bar">
      <div className="flex justify-around items-center h-12 max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const active = pathname === tab.path || pathname?.startsWith(tab.path + "/");
          return (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors ${
                active ? "text-ios-blue" : "text-ios-gray"
              }`}
            >
              <tab.icon active={active} />
              <span className="text-[10px] font-medium">{tab.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function BriefIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M4 6h16M4 10h16M4 14h10M4 18h8" strokeLinecap="round" />
    </svg>
  );
}

function TradesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M2 20L8 14l4 4 10-12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PortfolioIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function StatsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M4 20V10M10 20V4M16 20V14M22 20V8" strokeLinecap="round" />
    </svg>
  );
}

function TrainingIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}

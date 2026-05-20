"use client";

import { useEffect, useState } from "react";

export default function AppWindowFrame({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(Boolean(window.aiReaderDesktop?.isDesktop));
  }, []);

  if (!isDesktop) return <>{children}</>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <div className="app-window-drag-region flex h-11 shrink-0 items-center border-b border-[var(--panel-border)] bg-[var(--toolbar-bg)]/95 pl-32 pr-4">
        <div className="min-w-0 truncate text-xs font-medium text-[var(--text-secondary)]">
          AI Reader
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

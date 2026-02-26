import React from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * SubpageHeader
 * Consistent top bar for non-tab pages (forms, admin screens).
 */
export default function SubpageHeader({ title, subtitle, right, onBack }) {
  const nav = useNavigate();

  return (
    <div className="sticky top-0 z-30 bg-blue-600 text-white">
      <div className="px-3 py-2.5 flex items-center gap-2">
        <button
          className="touch-target rounded-xl px-2 hover:bg-white/10 active:bg-white/15"
          aria-label="Back"
          onClick={() => (typeof onBack === "function" ? onBack() : nav(-1))}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{title}</div>
          {subtitle ? <div className="text-[11px] text-blue-100 truncate">{subtitle}</div> : null}
        </div>
        {right ? <div className="flex-shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}

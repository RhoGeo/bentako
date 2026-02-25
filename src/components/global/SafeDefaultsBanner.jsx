import React from "react";
import { AlertTriangle } from "lucide-react";

export default function SafeDefaultsBanner({ show }) {
  if (!show) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
      <p className="text-[11px] text-amber-700">
        Settings not fully loaded — using safe defaults. PIN required for all sensitive actions.
      </p>
    </div>
  );
}
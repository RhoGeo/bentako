import React from "react";
import { AlertOctagon, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function StopTheLineBanner({ reasons = [] }) {
  if (reasons.length === 0) return null;
  return (
    <Link to={createPageUrl("SyncStatus")}>
      <div className="bg-red-600 px-4 py-2.5 flex items-center gap-2">
        <AlertOctagon className="w-4 h-4 text-white flex-shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-bold">IMMEDIATE ATTENTION NEEDED</p>
          <p className="text-red-200 text-[10px] truncate">{reasons[0]}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-white flex-shrink-0" />
      </div>
    </Link>
  );
}
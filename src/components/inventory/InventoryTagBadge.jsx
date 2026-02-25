import React from "react";

const STYLES = {
  safe: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-orange-50 text-orange-700 border-orange-200",
  out: "bg-red-50 text-red-700 border-red-200",
};

export default function InventoryTagBadge({ tag, label }) {
  const cls = STYLES[tag] || STYLES.safe;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {label}
    </span>
  );
}

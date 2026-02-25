import React from "react";
import { Wifi, WifiOff, Loader2, AlertTriangle } from "lucide-react";

export default function ConnectionBadge({ status = "online", queuedCount = 0, failedCount = 0, onTap }) {
  const configs = {
    online: {
      icon: Wifi,
      color: "bg-emerald-500",
      textColor: "text-emerald-700",
      bgColor: "bg-emerald-50",
      label: "Online",
    },
    offline: {
      icon: WifiOff,
      color: "bg-stone-400",
      textColor: "text-stone-600",
      bgColor: "bg-stone-100",
      label: "Offline",
    },
    syncing: {
      icon: Loader2,
      color: "bg-blue-500",
      textColor: "text-blue-700",
      bgColor: "bg-blue-50",
      label: "Syncing",
      spin: true,
    },
    attention: {
      icon: AlertTriangle,
      color: "bg-amber-500",
      textColor: "text-amber-700",
      bgColor: "bg-amber-50",
      label: "Attention",
    },
  };

  const effectiveStatus =
    failedCount > 0 ? "attention" : queuedCount > 0 && status === "online" ? "attention" : status;
  const cfg = configs[effectiveStatus] || configs.online;
  const Icon = cfg.icon;

  return (
    <button
      onClick={onTap}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bgColor} touch-target no-select transition-all active:scale-95`}
    >
      <div className="relative">
        <Icon className={`w-3.5 h-3.5 ${cfg.textColor} ${cfg.spin ? "animate-spin" : ""}`} />
        {(queuedCount > 0 || failedCount > 0) && (
          <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-amber-500 border border-white" />
        )}
      </div>
      <span className={`text-xs font-medium ${cfg.textColor}`}>{cfg.label}</span>
    </button>
  );
}
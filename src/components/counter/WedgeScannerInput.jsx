import React, { useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { ScanLine } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export default function WedgeScannerInput({
  value,
  onChange,
  onEnterSubmit,
  autoAddOnEnter,
  setAutoAddOnEnter,
  placeholder = "Search or scan barcode…",
  onScanIconClick,
}) {
  const inputRef = useRef(null);
  const lastEnterTime = useRef(0);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const now = Date.now();
        const trimmed = (value || "").trim();
        if (!trimmed) return;
        if (now - lastEnterTime.current < 300) return; // debounce
        lastEnterTime.current = now;
        onEnterSubmit?.(trimmed);
      }
    },
    [value, onEnterSubmit]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="h-12 text-base pr-12 bg-white border-stone-200 rounded-xl"
            inputMode="search"
            autoComplete="off"
          />
          <button
            onClick={onScanIconClick}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all"
          >
            <ScanLine className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <Switch
          checked={autoAddOnEnter}
          onCheckedChange={setAutoAddOnEnter}
          className="scale-75"
        />
        <span className="text-[11px] text-stone-500">Auto-add on Enter</span>
      </div>
    </div>
  );
}
import React from "react";
import { ShieldOff } from "lucide-react";
import { guard } from "@/components/lib/permissions";

// Renders children if allowed, else shows a block message or nothing.
// Usage: <PermissionGate staffMember={staffMember} permission="transaction_void" block>...</PermissionGate>
export default function PermissionGate({ staffMember, permission, block = false, children }) {
  const { allowed, reason } = guard(staffMember, permission);
  if (allowed) return children;
  if (!block) return null;
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-6">
      <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-3">
        <ShieldOff className="w-6 h-6 text-stone-400" />
      </div>
      <p className="text-sm font-semibold text-stone-700 mb-1">Hindi pwede</p>
      <p className="text-xs text-stone-500 max-w-xs">{reason}</p>
    </div>
  );
}
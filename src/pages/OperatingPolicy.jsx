import React, { useState } from "react";
import { ArrowLeft, CheckSquare, Square, BookOpen, Shield, List, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCurrentStaff } from "@/components/lib/useCurrentStaff";
import { auditLog } from "@/components/lib/auditLog";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const PRINCIPLES = [
  { title: "Retail Truth", desc: "Every transaction is recorded immediately. No sale is 'just memory'. If it wasn't recorded, it didn't happen." },
  { title: "Cash is King, but Record is Proof", desc: "All cash must match. Shortfalls trigger investigation, not explanations." },
  { title: "Stock Never Lies", desc: "Physical count beats any number in the system. Sync discrepancies are stop-the-line events." },
  { title: "Utang is a Trust System", desc: "Every due sale requires a name. No anonymous utang. Payments must be recorded and acknowledged." },
  { title: "Offline is Normal, Not an Excuse", desc: "Internet loss does not pause business. Queued actions are as real as synced ones." },
];

const ROLES = [
  {
    role: "Owner",
    badge: "bg-yellow-100 text-yellow-800",
    responsibilities: [
      "Set and maintain Owner PIN",
      "Approve all voids, refunds, and price overrides",
      "Review daily sales report",
      "Manage staff roles and permissions",
      "Resolve all stop-the-line conditions",
      "Monitor sync failures and device list",
    ],
  },
  {
    role: "Manager",
    badge: "bg-blue-100 text-blue-800",
    responsibilities: [
      "Open and close register",
      "Handle customer complaints",
      "Reconcile stock discrepancies",
      "Record customer payments",
      "Escalate anomalies to owner",
    ],
  },
  {
    role: "Cashier",
    badge: "bg-stone-100 text-stone-600",
    responsibilities: [
      "Process all sales at counter",
      "Scan every item — no manual override without approval",
      "Collect exact payment, give correct change",
      "Never void or refund without manager/owner",
      "Report any barcode or price anomaly immediately",
    ],
  },
];

const STOP_THE_LINE = [
  "Cash drawer does not match end-of-day report",
  "Sync events failed permanently (failed_permanent > 0)",
  "Sale completed but no receipt/queue record created",
  "Negative stock in system when allow_negative_stock is OFF",
  "Repeated unauthorized action attempts on a device",
  "Unknown or revoked device attempting transactions",
];

const DAILY_CHECKLIST = [
  "Open: verify device is allowed and online status",
  "Open: check for queued sync events from yesterday",
  "Open: review low stock and out-of-stock items",
  "During: scan every item — no guesses",
  "During: record all utang with customer name",
  "Close: count cash and match to sales report",
  "Close: sync all pending events",
  "Close: review Today tab for anomalies",
];

const WEEKLY_CHECKLIST = [
  "Physical stock count vs system count",
  "Review all due accounts (utang aging)",
  "Check sync failures and resolve any permanent failures",
  "Review staff activity log",
  "Update product prices if needed (owner only)",
  "Check device list — revoke inactive devices",
];

export default function OperatingPolicy() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { staffMember, user } = useCurrentStaff();
  const [acknowledged, setAcknowledged] = useState(staffMember?.policy_acknowledged || false);
  const [saving, setSaving] = useState(false);

  const handleAcknowledge = async () => {
    if (acknowledged) return;
    setSaving(true);
    if (staffMember?.id) {
      await base44.entities.StaffMember.update(staffMember.id, {
        policy_acknowledged: true,
        policy_acknowledged_at: new Date().toISOString(),
      });
    }
    await auditLog("policy_acknowledged", `Policy acknowledged by ${user?.email}`, {
      actor_email: user?.email,
      metadata: { role: staffMember?.role, acknowledged_at: new Date().toISOString() },
    });
    queryClient.invalidateQueries({ queryKey: ["staff-member"] });
    setAcknowledged(true);
    setSaving(false);
    toast.success("Salamat! Policy acknowledged.");
  };

  const Section = ({ icon: Icon, title, children }) => (
    <div className="bg-white rounded-xl border border-stone-100 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-stone-500" />
        <h3 className="text-sm font-bold text-stone-800">{title}</h3>
      </div>
      {children}
    </div>
  );

  return (
    <div className="pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800 flex-1">Operating Policy</h1>
        <BookOpen className="w-4 h-4 text-stone-400" />
      </div>

      <div className="px-4 py-5 space-y-4">
        {/* Acknowledgement */}
        <div className={`rounded-xl border p-4 ${acknowledged ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-center gap-3">
            {acknowledged ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p className={`text-sm font-semibold ${acknowledged ? "text-emerald-800" : "text-amber-800"}`}>
                {acknowledged ? "Policy Acknowledged ✓" : "Please read and acknowledge this policy"}
              </p>
              <p className={`text-xs mt-0.5 ${acknowledged ? "text-emerald-600" : "text-amber-600"}`}>
                {acknowledged ? `Acknowledged on ${new Date().toLocaleDateString("en-PH")}` : "Tap below after reading."}
              </p>
            </div>
          </div>
          {!acknowledged && (
            <Button className="w-full mt-3 h-10 bg-amber-500 hover:bg-amber-600 text-white" onClick={handleAcknowledge} disabled={saving}>
              {saving ? "Saving…" : "I have read and understood this policy"}
            </Button>
          )}
        </div>

        <Tabs defaultValue="principles">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="principles" className="text-[10px]">Principles</TabsTrigger>
            <TabsTrigger value="roles" className="text-[10px]">Roles</TabsTrigger>
            <TabsTrigger value="stop" className="text-[10px]">Stop-Line</TabsTrigger>
            <TabsTrigger value="checklist" className="text-[10px]">Checklist</TabsTrigger>
          </TabsList>

          <TabsContent value="principles" className="space-y-3 pt-3">
            <Section icon={Shield} title="Retail-Truth Principles">
              <div className="space-y-3">
                {PRINCIPLES.map((p, i) => (
                  <div key={i} className="border-b border-stone-50 last:border-0 pb-3 last:pb-0">
                    <p className="text-sm font-semibold text-stone-800">{i + 1}. {p.title}</p>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{p.desc}</p>
                  </div>
                ))}
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="roles" className="space-y-3 pt-3">
            {ROLES.map((r) => (
              <Section key={r.role} icon={Shield} title="">
                <div className="flex items-center gap-2 -mt-1 mb-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${r.badge}`}>{r.role}</span>
                  <span className="text-xs text-stone-400">Responsibilities</span>
                </div>
                <ul className="space-y-1.5">
                  {r.responsibilities.map((resp, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 flex-shrink-0" />
                      {resp}
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </TabsContent>

          <TabsContent value="stop" className="space-y-3 pt-3">
            <Section icon={AlertTriangle} title="Stop-the-Line Conditions">
              <p className="text-xs text-stone-500">When any of these occur, all counter activity STOPS until resolved by Owner.</p>
              <ul className="space-y-2 mt-2">
                {STOP_THE_LINE.map((cond, i) => (
                  <li key={i} className="flex items-start gap-2 bg-red-50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-red-700">{cond}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </TabsContent>

          <TabsContent value="checklist" className="space-y-3 pt-3">
            <Section icon={List} title="Daily Checklist">
              <ul className="space-y-2">
                {DAILY_CHECKLIST.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                    <CheckSquare className="w-3.5 h-3.5 text-stone-400 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
            <Section icon={List} title="Weekly Checklist">
              <ul className="space-y-2">
                {WEEKLY_CHECKLIST.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                    <CheckSquare className="w-3.5 h-3.5 text-stone-400 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
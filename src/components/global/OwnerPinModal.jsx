import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Delete } from "lucide-react";
import { verifyPin } from "@/components/lib/pinVerify";
import { auditLog } from "@/components/lib/auditLog";

const MAX_ATTEMPTS = 3;
const COOLDOWN_MS = 30_000;

export default function OwnerPinModal({ open, onClose, onApproved, actionContext = "action", storedHash, actorEmail }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    if (!open) {
      setPin("");
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownLeft(left);
      if (left === 0) {
        setCooldownUntil(null);
        setAttempts(0);
        setError("");
      }
    }, 500);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const isCooling = !!cooldownUntil && cooldownLeft > 0;

  const handleDigit = (d) => {
    if (isCooling || pin.length >= 6) return;
    setPin((p) => p + d);
    setError("");
  };

  const handleDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError("");
  };

  const handleSubmit = async () => {
    if (pin.length < 4) { setError("Kulang ang PIN."); return; }

    await auditLog("owner_pin_prompted", `PIN prompted for: ${actionContext}`, { actor_email: actorEmail, metadata: { action: actionContext } });

    // If no PIN is set, allow through (first-time setup case)
    if (!storedHash) {
      await auditLog("owner_pin_approved", `PIN approved (no PIN set) for: ${actionContext}`, { actor_email: actorEmail });
      onApproved?.({ owner_pin_proof: null });
      return;
    }

    const ok = await verifyPin(pin, storedHash);
    if (ok) {
      await auditLog("owner_pin_approved", `PIN approved for: ${actionContext}`, { actor_email: actorEmail, metadata: { action: actionContext } });
      setPin("");
      // Proof is the stored SHA-256 hash of the PIN (server expects owner_pin_proof === owner_pin_hash)
      onApproved?.({ owner_pin_proof: storedHash });
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      await auditLog("owner_pin_failed", `PIN failed (attempt ${newAttempts}) for: ${actionContext}`, { actor_email: actorEmail, metadata: { action: actionContext, attempt: newAttempts } });
      setPin("");

      if (newAttempts >= MAX_ATTEMPTS) {
        setCooldownUntil(Date.now() + COOLDOWN_MS);
        setError(`Maraming maling PIN. Maghintay ng 30 segundo.`);
      } else {
        setError(`Mali ang PIN. ${MAX_ATTEMPTS - newAttempts} pagkakataon pa.`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-xs mx-auto p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Lock className="w-5 h-5 text-blue-600" />
            Owner PIN Required
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-stone-500 text-center mb-3">
          Action: <span className="font-semibold text-stone-700">{actionContext}</span>
        </p>

        {/* Dots */}
        <div className="flex justify-center gap-3 my-3">
          {[0,1,2,3,4,5].map((i) => (
            <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all ${i < pin.length ? "bg-blue-600 scale-110" : "bg-stone-200"}`} />
          ))}
        </div>

        {error && <p className="text-center text-red-500 text-xs font-medium mb-2">{error}</p>}
        {isCooling && <p className="text-center text-amber-600 text-xs mb-2">Maghintay: {cooldownLeft}s</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6,7,8,9].map((d) => (
            <Button key={d} variant="outline" className="h-14 text-xl font-semibold touch-target"
              onClick={() => handleDigit(String(d))} disabled={isCooling}>{d}</Button>
          ))}
          <Button variant="ghost" className="h-14 touch-target" onClick={handleDelete}><Delete className="w-5 h-5" /></Button>
          <Button variant="outline" className="h-14 text-xl font-semibold touch-target"
            onClick={() => handleDigit("0")} disabled={isCooling}>0</Button>
          <Button className="h-14 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white touch-target"
            onClick={handleSubmit} disabled={isCooling || pin.length < 4}>OK</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
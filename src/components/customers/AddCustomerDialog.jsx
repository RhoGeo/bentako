import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { invokeFunction } from "@/api/posyncClient";
import { toast } from "sonner";

export default function AddCustomerDialog({ open, onOpenChange, storeId, onCreated }) {
  const [form, setForm] = useState({ name: "", phone: "", address: "", allow_utang: true, credit_limit_peso: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ name: "", phone: "", address: "", allow_utang: true, credit_limit_peso: "", notes: "" });
    setSaving(false);
  }, [open]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!storeId) return;
    if (!navigator.onLine) {
      toast.error("Connect to internet to add a customer.");
      return;
    }
    if (!String(form.name || "").trim()) {
      toast.error("Customer name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await invokeFunction("createCustomer", {
        store_id: storeId,
        customer: {
          name: String(form.name || "").trim(),
          phone: String(form.phone || "").trim(),
          address: String(form.address || "").trim(),
          allow_utang: !!form.allow_utang,
          credit_limit_peso: String(form.credit_limit_peso || "").trim(),
          notes: String(form.notes || "").trim(),
        },
      });
      const customer = res?.data?.customer || null;
      if (!customer) throw new Error("Failed to create customer");

      toast.success("Customer added");
      onCreated?.(customer);
      onOpenChange?.(false);
    } catch (e) {
      toast.error(e?.message || "Failed to add customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Customer</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-stone-500 mb-1.5 block">Name *</Label>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} className="h-11" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Phone</Label>
              <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} className="h-11" />
            </div>
            <div>
              <Label className="text-xs text-stone-500 mb-1.5 block">Credit limit (₱)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={form.credit_limit_peso}
                onChange={(e) => update("credit_limit_peso", e.target.value)}
                placeholder="optional"
                className="h-11"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-stone-500 mb-1.5 block">Address</Label>
            <Input value={form.address} onChange={(e) => update("address", e.target.value)} className="h-11" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm text-stone-700">Allow Utang</Label>
            <Switch checked={form.allow_utang} onCheckedChange={(v) => update("allow_utang", v)} />
          </div>

          <div>
            <Label className="text-xs text-stone-500 mb-1.5 block">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} className="resize-none h-20" />
          </div>

          <Button className="w-full h-11 bg-blue-600 hover:bg-blue-700" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save Customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

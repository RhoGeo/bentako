import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invokeFunction } from "@/api/posyncClient";
import { getDeviceId } from "@/lib/ids/deviceId";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { setActiveStoreId } from "@/components/lib/activeStore";

function unwrap(res) {
  return res?.data?.data || res?.data || res;
}

export default function FirstStoreSetup() {
  const nav = useNavigate();
  const { refreshAuth } = useAuth();
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = useMemo(() => storeName.trim().length >= 2, [storeName]);

  const onCreate = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await invokeFunction("createFirstStore", {
        store_name: storeName.trim(),
        device_id: getDeviceId(),
      });
      const payload = unwrap(res);
      if (payload?.ok === false) {
        const msg = payload?.error?.message || "Create store failed";
        setError(msg);
        toast.error(msg);
        return;
      }
      const data = payload?.data || payload;
      const store_id = data?.store?.id || data?.store?.store_id;
      if (store_id) setActiveStoreId(store_id);

      await refreshAuth();

      toast.success("Store created! Tara, benta na.");
      nav(createPageUrl("Counter"), { replace: true });
    } catch (err) {
      const msg = err?.message || "Create store failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <h1 className="text-xl font-bold text-stone-800">First Store Setup</h1>
          <p className="text-sm text-stone-500 mt-1">What is your Store Name?</p>

          <form onSubmit={onCreate} className="mt-5 space-y-4">
            <div>
              <Label className="text-xs text-stone-500">Store Name</Label>
              <Input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Nanay's Sari-Sari"
                className="h-12"
                maxLength={60}
              />
            </div>

            {error && <div className="text-xs text-red-600">{error}</div>}

            <Button
              type="submit"
              className="w-full h-12 bg-blue-600 hover:bg-blue-700"
              disabled={!canSubmit || loading}
            >
              {loading ? "Creating…" : "Create Store"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { setActiveStoreId } from "@/components/lib/activeStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { invokeFunction } from "@/api/posyncClient";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { user, refreshAuth } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token") || "";
  const [token, setToken] = useState(tokenFromUrl);
  const [loading, setLoading] = useState(false);
  const userEmail = user?.email || "";

  const accept = async () => {
    if (!token.trim()) return toast.error("Invite token required.");
    setLoading(true);
    try {
      const res = await invokeFunction("acceptStaffInvite", { invite_token: token.trim() });
      const payload = res?.data?.data || res?.data || res;
      const data = payload?.data || payload;
      const storeId = data?.store_id;
      if (!storeId) {
        toast.error(payload?.error?.message || "Invite failed.");
        return;
      }
      setActiveStoreId(storeId);
      try { await refreshAuth(); } catch (_e) {}
      toast.success("Invite accepted.");
      navigate(createPageUrl("Counter"), { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-stone-50 pb-24">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-3 flex items-center gap-3 z-20">
        <button onClick={() => navigate(-1)} className="touch-target"><ArrowLeft className="w-5 h-5 text-stone-600" /></button>
        <h1 className="text-lg font-bold text-stone-800">Accept Staff Invite</h1>
      </div>

      <div className="px-4 py-6 max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-stone-800">Join a store via invite</p>
              <p className="text-xs text-stone-500">You must be logged in as the invited email.</p>
            </div>
          </div>

          {userEmail ? (
            <p className="text-xs text-stone-500 mb-3">Logged in as: <span className="font-mono">{userEmail}</span></p>
          ) : (
            <p className="text-xs text-amber-600 mb-3">Not logged in yet — you may be redirected to login.</p>
          )}

          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste invite token"
            className="h-12 font-mono"
          />

          <Button
            className="w-full h-12 mt-3 bg-blue-600 hover:bg-blue-700"
            onClick={accept}
            disabled={loading}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {loading ? "Accepting…" : "Accept Invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}

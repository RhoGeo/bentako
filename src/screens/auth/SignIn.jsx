import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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

function extractApiErrorMessage(err) {
  const d = err?.response?.data || err?.data;
  const msg = d?.error?.message || d?.message;
  return msg || err?.message || "Sign in failed";
}

function normalizeSession(session) {
  if (!session) return null;
  const exp = session.access_expires_at || session.expires_at;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    access_expires_at: exp,
    expires_at: exp,
  };
}

export default function SignIn() {
  const nav = useNavigate();
  const loc = useLocation();
  const { commitSession, refreshAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const from = loc.state?.from || createPageUrl("Counter");
  const canSubmit = useMemo(() => email.trim() && password.trim(), [email, password]);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await invokeFunction("authSignIn", {
        email: email.trim(),
        password,
        device_id: getDeviceId(),
      });
      const payload = unwrap(res);
      if (payload?.ok === false) {
        const msg = payload?.error?.message || "Sign in failed";
        setError(msg);
        toast.error(msg);
        return;
      }
      const data = payload?.data || payload;
      const session = normalizeSession(data?.session);
      await commitSession(session, data?.user);

      // Populate memberships/stores via authMe (routing gate depends on it).
      await refreshAuth();

      // Route using server hint when available.
      const next_action = data?.next_action;
      const stores = data?.stores || [];
      if (next_action === "create_first_store") {
        nav("/first-store", { replace: true });
        return;
      }
      if (stores.length === 0) {
        nav("/no-store", { replace: true });
        return;
      }
      if (stores.length === 1) {
        setActiveStoreId(stores[0].id || stores[0].store_id);
        nav(createPageUrl("Counter"), { replace: true });
        return;
      }
      if (stores.length > 1) {
        nav(createPageUrl("StoreSwitcher"), { replace: true });
        return;
      }

      // Fallback
      nav(from, { replace: true });
    } catch (err) {
      const msg = extractApiErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-stone-800">POSync</h1>
          <p className="text-sm text-stone-500">Sign in to your store</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <div>
            <Label className="text-xs text-stone-500">Email Address</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              placeholder="juan@email.com"
              className="h-12"
            />
          </div>
          <div>
            <Label className="text-xs text-stone-500">Password</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              className="h-12"
            />
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <Button
            type="submit"
            className="w-full h-12 bg-blue-600 hover:bg-blue-700"
            disabled={!canSubmit || loading}
          >
            {loading ? "Signing in…" : "Sign In"}
          </Button>

          <div className="text-center text-xs text-stone-500">
            Walang account?{" "}
            <Link className="text-blue-600 font-medium" to="/signup">
              Sign up
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

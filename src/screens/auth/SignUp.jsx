import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invokeFunction } from "@/api/posyncClient";
import { getDeviceId } from "@/lib/ids/deviceId";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

function unwrap(res) {
  return res?.data?.data || res?.data || res;
}

function extractApiErrorMessage(err) {
  // fetch wrapper stores the server JSON here
  const payload = err?.payload;

  const msg =
    payload?.error?.message ||
    err?.message ||
    "Sign up failed";

  const details =
    payload?.error?.details?.message ||
    payload?.error?.details?.hint ||
    payload?.error?.details?.details ||
    payload?.error?.details;

  // only show verbose detail in dev to avoid leaking internals in prod
  if (import.meta.env.DEV && details) return `${msg} — ${typeof details === "string" ? details : JSON.stringify(details)}`;

  return msg;
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

const SIGNUP_DETAILS_KEY = "posync_signup_details_v1";

export default function SignUp() {
  const nav = useNavigate();
  const { commitSession, refreshAuth } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mismatch = password && confirmPassword && password !== confirmPassword;
  const canSubmit = useMemo(() => {
    return (
      fullName.trim() &&
      phone.trim() &&
      email.trim() &&
      password &&
      confirmPassword &&
      !mismatch
    );
  }, [fullName, phone, email, password, confirmPassword, mismatch]);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      const device_id = getDeviceId();
      const body = {
        full_name: fullName.trim(),
        phone_number: phone.trim(),
        email: email.trim(),
        password,
        confirm_password: confirmPassword,
        invitation_code: inviteCode.trim() || "",
        device_id,
      };

      const res = await invokeFunction("authSignUp", body);
      const payload = unwrap(res);
      if (payload?.ok === false) {
        const msg = payload?.error?.message || "Sign up failed";
        setError(msg);
        toast.error(msg);
        return;
      }
      const data = payload?.data || payload;
      const session = normalizeSession(data?.session);
      await commitSession(session, data?.user);
      await refreshAuth();

      // Persist details for Welcome page (also survives accidental refresh).
      const details = {
        full_name: body.full_name,
        phone_number: body.phone_number,
        email: body.email,
        invitation_code: body.invitation_code || "",
        next_action: data?.next_action,
        stores: data?.stores || [],
        memberships: data?.memberships || [],
      };
      try {
        sessionStorage.setItem(SIGNUP_DETAILS_KEY, JSON.stringify(details));
      } catch (_e) {}

      nav("/welcome", { replace: true, state: details });
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
          <h1 className="text-xl font-bold text-stone-800">Create account</h1>
          <p className="text-sm text-stone-500">Para sa sari-sari POS</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <div>
            <Label className="text-xs text-stone-500">Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-12" />
          </div>
          <div>
            <Label className="text-xs text-stone-500">Phone Number</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="09xxxxxxxxx"
              className="h-12"
            />
          </div>
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
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="h-12" />
          </div>
          <div>
            <Label className="text-xs text-stone-500">Confirm Password</Label>
            <Input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              className={`h-12 ${mismatch ? "border-red-400 focus-visible:ring-red-400" : ""}`}
            />
            {mismatch && <div className="text-[11px] text-red-600 mt-1">Passwords do not match.</div>}
          </div>
          <div>
            <Label className="text-xs text-stone-500">Invitation Code (optional)</Label>
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="STAFF-XXXX or REF-XXXX"
              className="h-12 font-mono"
            />
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <Button
            type="submit"
            className="w-full h-12 bg-blue-600 hover:bg-blue-700"
            disabled={!canSubmit || loading}
          >
            {loading ? "Creating…" : "Sign Up"}
          </Button>

          <div className="text-center text-xs text-stone-500">
            May account na?{" "}
            <Link className="text-blue-600 font-medium" to="/signin">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export function readSignupDetailsFromSession() {
  try {
    const raw = sessionStorage.getItem(SIGNUP_DETAILS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

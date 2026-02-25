import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = useMemo(() => params.get("redirect") || "/", [params]);

  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is enabled.");
        // If email confirmation is disabled, you may already be logged in.
        navigate(redirect);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate(redirect);
      }
    } catch (err) {
      toast.error(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-stone-900">Bentako POS</h1>
        <p className="text-sm text-stone-500 mt-1">
          {mode === "signin" ? "Sign in to continue" : "Create an account"}
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Sign Up"}
          </Button>
        </form>

        <div className="mt-4 text-sm text-stone-600">
          {mode === "signin" ? (
            <button
              className="underline"
              onClick={() => setMode("signup")}
              type="button"
            >
              Create an account
            </button>
          ) : (
            <button
              className="underline"
              onClick={() => setMode("signin")}
              type="button"
            >
              I already have an account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { setActiveStoreId } from "@/components/lib/activeStore";
import { readSignupDetailsFromSession } from "./SignUp";

export default function Welcome() {
  const nav = useNavigate();
  const loc = useLocation();

  const details = useMemo(() => {
    return loc.state || readSignupDetailsFromSession() || null;
  }, [loc.state]);

  const full_name = details?.full_name || "";
  const phone_number = details?.phone_number || "";
  const email = details?.email || "";
  const invitation_code = details?.invitation_code || "";
  const next_action = details?.next_action;
  const stores = details?.stores || [];
  const memberships = details?.memberships || [];

  const goNext = () => {
    // HARD GATE: brand-new signup must show this page first.
    if (next_action === "create_first_store" || memberships.length === 0 || stores.length === 0) {
      nav("/first-store", { replace: true });
      return;
    }

    // Staff invite → skip first store.
    if (stores.length > 1) {
      nav(createPageUrl("StoreSwitcher"), { replace: true });
      return;
    }
    if (stores.length === 1) {
      setActiveStoreId(stores[0].id || stores[0].store_id);
      nav(createPageUrl("Counter"), { replace: true });
      return;
    }

    nav(createPageUrl("Counter"), { replace: true });
  };

  return (
    <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <h1 className="text-xl font-bold text-stone-800">Welcome!</h1>
          <p className="text-sm text-stone-500 mt-1">Ito ang details na in-enter mo:</p>

          <div className="mt-5 space-y-3 text-sm">
            <div>
              <div className="text-[11px] text-stone-400">Full Name</div>
              <div className="font-semibold text-stone-800">{full_name || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-stone-400">Phone Number</div>
              <div className="font-semibold text-stone-800">{phone_number || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-stone-400">Email Address</div>
              <div className="font-semibold text-stone-800 break-all">{email || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-stone-400">Invitation Code</div>
              <div className="font-semibold text-stone-800 font-mono">{invitation_code || "(none)"}</div>
            </div>
          </div>

          <Button className="w-full h-12 bg-blue-600 hover:bg-blue-700 mt-6" onClick={goNext}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}

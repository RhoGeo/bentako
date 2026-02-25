import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Store, Gift, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createPageUrl } from "@/utils";
import { useAuth } from "@/lib/AuthContext";

export default function NoStoreHome() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="min-h-[100dvh] bg-stone-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-stone-800">Welcome, {user?.full_name || ""}</h1>
          <p className="text-sm text-stone-500">Wala pang store membership sa account mo.</p>
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Store className="w-4 h-4 text-blue-600" /> Create a Store
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-stone-500 mb-3">Kung ikaw ay store owner, gumawa ng store para magamit ang POS.</p>
              <Button className="w-full h-11" onClick={() => navigate("/first-store")}>
                Create Store <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Gift className="w-4 h-4 text-amber-600" /> Affiliate Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-stone-500 mb-3">You can still be an affiliate even without a store.</p>
              <Link to={createPageUrl("Affiliate")}>
                <Button variant="outline" className="w-full h-11">
                  Go to Affiliate <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <p className="text-[11px] text-stone-400">
            Tip: If you were invited as staff, ask the owner to resend your invite / ensure your membership is active.
          </p>
        </div>
      </div>
    </div>
  );
}

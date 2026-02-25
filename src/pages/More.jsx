import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Users,
  RefreshCw,
  UserCog,
  Settings,
  Smartphone,
  Gift,
  Wallet,
  ChevronRight,
  LogOut,
  BookOpen,
  ShieldCheck,
  Store,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const menuItems = [
  {
    label: "My Stores",
    icon: Store,
    page: "MyStores",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    label: "Owner Combined View",
    icon: Layers,
    page: "CombinedView",
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
  },
  {
    label: "Operating Policy",
    icon: BookOpen,
    page: "OperatingPolicy",
    color: "text-teal-600",
    bgColor: "bg-teal-50",
  },
  {
    label: "Permissions",
    icon: ShieldCheck,
    page: "Permissions",
    color: "text-purple-600",
    bgColor: "bg-purple-50",
  },
  {
    label: "Customers (Utang)",
    icon: Users,
    page: "CustomersDue",
    color: "text-red-500",
    bgColor: "bg-red-50",
  },
  {
    label: "Sync",
    icon: RefreshCw,
    page: "SyncStatus",
    color: "text-blue-500",
    bgColor: "bg-blue-50",
  },
  {
    label: "Staff & Roles",
    icon: UserCog,
    page: "Staff",
    color: "text-purple-500",
    bgColor: "bg-purple-50",
  },
  {
    label: "Store Settings",
    icon: Settings,
    page: "StoreSettings",
    color: "text-stone-500",
    bgColor: "bg-stone-100",
  },
  {
    label: "Devices",
    icon: Smartphone,
    page: "Devices",
    color: "text-emerald-500",
    bgColor: "bg-emerald-50",
  },
  {
    label: "Affiliate / Referral",
    icon: Gift,
    page: "Affiliate",
    color: "text-amber-500",
    bgColor: "bg-amber-50",
  },
  {
    label: "Payouts",
    icon: Wallet,
    page: "Payouts",
    color: "text-indigo-500",
    bgColor: "bg-indigo-50",
  },
];

export default function More() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  return (
    <div className="px-4 py-5 pb-24">
      <h1 className="text-xl font-bold text-stone-800 mb-5">More</h1>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <Link key={item.label} to={createPageUrl(item.page)}>
              <div
                className={`flex items-center gap-3 px-4 py-3.5 active:bg-stone-50 transition-colors ${
                  index < menuItems.length - 1 ? "border-b border-stone-50" : ""
                }`}
              >
                <div className={`w-9 h-9 rounded-lg ${item.bgColor} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4.5 h-4.5 ${item.color}`} />
                </div>
                <span className="text-sm font-medium text-stone-700 flex-1">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Logout */}
      <button
        onClick={async () => {
          await signOut();
          navigate("/signin", { replace: true });
        }}
        className="w-full mt-6 flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-100 text-stone-500 text-sm font-medium hover:bg-stone-200 transition-colors touch-target"
      >
        <LogOut className="w-4 h-4" />
        Logout
      </button>
    </div>
  );
}
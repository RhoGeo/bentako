import React from "react";
import { Package, AlertTriangle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function InventoryHealthCard({ totalSellable = 0, trackedCount = 0, lowStockCount = 0, outOfStockCount = 0 }) {
  return (
    <div className="bg-white rounded-xl border border-stone-100 p-4 shadow-sm">
      <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Inventory Health</h3>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <Package className="w-4 h-4 mx-auto text-stone-400 mb-1" />
          <p className="text-lg font-bold text-stone-800">{totalSellable}</p>
          <p className="text-[10px] text-stone-400">Sellable</p>
        </div>
        <div>
          <Package className="w-4 h-4 mx-auto text-blue-400 mb-1" />
          <p className="text-lg font-bold text-stone-800">{trackedCount}</p>
          <p className="text-[10px] text-stone-400">Tracked</p>
        </div>
        <Link to={createPageUrl("Items") + "?filter=low_stock"}>
          <div className="cursor-pointer hover:bg-amber-50 rounded-lg py-1 -my-1">
            <AlertTriangle className="w-4 h-4 mx-auto text-amber-500 mb-1" />
            <p className="text-lg font-bold text-amber-600">{lowStockCount}</p>
            <p className="text-[10px] text-stone-400">Low</p>
          </div>
        </Link>
        <Link to={createPageUrl("Items") + "?filter=out_of_stock"}>
          <div className="cursor-pointer hover:bg-red-50 rounded-lg py-1 -my-1">
            <XCircle className="w-4 h-4 mx-auto text-red-500 mb-1" />
            <p className="text-lg font-bold text-red-600">{outOfStockCount}</p>
            <p className="text-[10px] text-stone-400">Out</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
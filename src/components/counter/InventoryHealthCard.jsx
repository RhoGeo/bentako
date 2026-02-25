import React from "react";
import { Package, AlertTriangle, XCircle, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function InventoryHealthCard({
  totalSellable = 0,
  trackedCount = 0,
  lowStockCount = 0,
  outOfStockCount = 0,
  negativeStockCount = 0,
  showNegative = false,
  onAdjustStock,
}) {
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

      {(onAdjustStock || showNegative) && (
        <div className="mt-4 flex items-center gap-2">
          {onAdjustStock && (
            <button
              onClick={onAdjustStock}
              className="flex-1 h-11 rounded-xl bg-stone-900 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Adjust Stock
            </button>
          )}
          {showNegative && (
            <div className="h-11 px-3 rounded-xl border border-stone-200 bg-stone-50 flex items-center gap-2">
              <span className="text-[11px] text-stone-500">Negative</span>
              <span className="text-sm font-bold text-stone-800">{negativeStockCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
import React from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2, ShoppingCart, ParkingCircle } from "lucide-react";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function CartLineItem({ item, onInc, onDec, onRemove }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-stone-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-stone-800 truncate">{item.product_name}</p>
        <CentavosDisplay centavos={item.unit_price_centavos} size="xs" className="text-stone-500" />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onDec?.(item.product_id)}
          className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center active:bg-stone-200 touch-target"
        >
          <Minus className="w-3.5 h-3.5 text-stone-600" />
        </button>
        <span className="w-8 text-center font-bold text-sm tabular-nums">{item.qty}</span>
        <button
          onClick={() => onInc?.(item.product_id)}
          className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center active:bg-blue-200 touch-target"
        >
          <Plus className="w-3.5 h-3.5 text-blue-700" />
        </button>
      </div>
      <CentavosDisplay centavos={item.line_total_centavos} size="xs" className="w-16 text-right" />
      <button
        onClick={() => onRemove?.(item.product_id)}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function CartPanel({
  items = [],
  subtotalCentavos = 0,
  discountCentavos = 0,
  totalCentavos = 0,
  onInc,
  onDec,
  onRemove,
  onComplete,
  onPark,
}) {
  const itemCount = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="fixed bottom-20 left-4 right-4 bg-blue-600 text-white rounded-2xl p-4 shadow-xl flex items-center justify-between active:scale-[0.98] transition-transform z-30 safe-bottom">
          <div className="flex items-center gap-3">
            <div className="relative">
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-amber-400 text-black text-[10px] font-bold flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </div>
            <span className="font-medium text-sm">
              {itemCount === 0 ? "Cart is empty" : `${itemCount} item${itemCount > 1 ? "s" : ""}`}
            </span>
          </div>
          <CentavosDisplay centavos={totalCentavos} size="lg" className="text-white" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-stone-100">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            Cart
            <span className="text-sm font-normal text-stone-400">({itemCount} items)</span>
          </SheetTitle>
        </SheetHeader>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {items.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-sm">
              Walang laman ang cart.
            </div>
          ) : (
            items.map((item) => (
              <CartLineItem
                key={item.product_id}
                item={item}
                onInc={onInc}
                onDec={onDec}
                onRemove={onRemove}
              />
            ))
          )}
        </div>

        {/* Totals + actions */}
        {items.length > 0 && (
          <div className="border-t border-stone-200 px-5 py-4 bg-stone-50 safe-bottom">
            <div className="space-y-1 mb-4">
              <div className="flex justify-between text-sm text-stone-500">
                <span>Subtotal</span>
                <CentavosDisplay centavos={subtotalCentavos} size="sm" className="text-stone-600" />
              </div>
              {discountCentavos > 0 && (
                <div className="flex justify-between text-sm text-red-500">
                  <span>Discount</span>
                  <span>-<CentavosDisplay centavos={discountCentavos} size="sm" /></span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-1 border-t border-stone-200 mt-2">
                <span>Total</span>
                <CentavosDisplay centavos={totalCentavos} size="lg" className="text-blue-700" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-12 touch-target text-stone-600"
                onClick={onPark}
              >
                <ParkingCircle className="w-4 h-4 mr-2" />
                Park
              </Button>
              <Button
                className="flex-[2] h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold touch-target"
                onClick={onComplete}
              >
                Complete
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
import React, { useState } from "react";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Package } from "lucide-react";

const CATEGORY_CHIPS = ["All", "Drinks", "Snacks", "Canned", "Hygiene", "Others"];

export default function QuickProductGrid({ products = [], cartItems = {}, onTap, onLongPress }) {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const longPressTimer = React.useRef(null);

  const filtered =
    selectedCategory === "All"
      ? products
      : products.filter((p) => p.category === selectedCategory);

  const handleTouchStart = (product) => {
    longPressTimer.current = setTimeout(() => {
      onLongPress?.(product);
    }, 500);
  };

  const handleTouchEnd = () => {
    clearTimeout(longPressTimer.current);
  };

  return (
    <div>
      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1 mb-3">
        {CATEGORY_CHIPS.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all no-select ${
              selectedCategory === cat
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="grid grid-cols-3 gap-2">
        {filtered.slice(0, 12).map((product) => {
          const qty = cartItems[product.id] || 0;
          return (
            <button
              key={product.id}
              onClick={() => onTap?.(product)}
              onTouchStart={() => handleTouchStart(product)}
              onTouchEnd={handleTouchEnd}
              onMouseDown={() => handleTouchStart(product)}
              onMouseUp={handleTouchEnd}
              className="relative bg-white rounded-xl p-3 border border-stone-100 shadow-sm hover:shadow-md active:scale-[0.97] transition-all text-left no-select"
            >
              {qty > 0 && (
                <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shadow-md z-10">
                  {qty}
                </div>
              )}
              <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center mb-2">
                <Package className="w-4 h-4 text-stone-400" />
              </div>
              <p className="text-xs font-medium text-stone-800 leading-tight line-clamp-2 mb-1">
                {product.name}
              </p>
              <CentavosDisplay
                centavos={product.selling_price_centavos}
                size="xs"
                className="text-blue-700"
              />
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-stone-400 text-sm">
          Walang products dito.
        </div>
      )}
    </div>
  );
}
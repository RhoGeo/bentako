import React, { useMemo, useState } from "react";
import CentavosDisplay from "@/components/shared/CentavosDisplay";
import { Package } from "lucide-react";

export default function QuickProductGrid({ products = [], cartItems = {}, onTap, onLongPress, loading = false }) {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const longPressTimer = React.useRef(null);

  const categoryChips = useMemo(() => {
    const set = new Set();
    for (const p of products || []) {
      const c = (p?.category || p?.category_name || "").toString().trim();
      if (c) set.add(c);
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b));
    return ["All", ...list];
  }, [products]);

  const filtered =
    selectedCategory === "All"
      ? products
      : products.filter((p) => p.category === selectedCategory);

  const handleTouchStart = (productId) => {
    longPressTimer.current = setTimeout(() => {
      onLongPress?.(productId);
    }, 500);
  };

  const handleTouchEnd = () => {
    clearTimeout(longPressTimer.current);
  };

  return (
    <div>
      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1 mb-3">
        {categoryChips.map((cat) => (
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
      <div className="grid grid-cols-3 gap-3">
        {filtered.slice(0, 12).map((product) => {
          const qty = cartItems[product.id] || 0;
          const title = product.counter_title || product.parent_name || product.name;
          const subtitle = product.counter_subtitle || product.variant_name || "";
          return (
            <button
              key={product.id}
              onClick={() => onTap?.(product)}
              onTouchStart={() => handleTouchStart(product.id)}
              onTouchEnd={handleTouchEnd}
              onMouseDown={() => handleTouchStart(product.id)}
              onMouseUp={handleTouchEnd}
              aria-label={`Add ${title}${subtitle ? ` - ${subtitle}` : ""}`}
              className="relative bg-white rounded-2xl p-3.5 border border-stone-100 shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-center no-select"
            >
              {qty > 0 && (
                <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shadow-md z-10">
                  {qty}
                </div>
              )}
              {/* Avatar */}
              <div className="mx-auto w-12 h-12 rounded-full bg-red-500/90 flex items-center justify-center mb-2 shadow-sm">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt=""
                    className="w-full h-full object-cover rounded-full"
                    loading="lazy"
                  />
                ) : (
                  <Package className="w-5 h-5 text-white" />
                )}
              </div>

              <div className="min-h-[44px]">
                <p className="text-sm font-semibold text-stone-800 leading-tight line-clamp-2">
                  {title}
                </p>
                {subtitle ? (
                  <p className="text-xs text-stone-500 leading-tight line-clamp-2 mt-0.5">
                    {subtitle}
                  </p>
                ) : null}
              </div>

              <div className="mt-2">
                <CentavosDisplay
                  centavos={product.selling_price_centavos}
                  size="sm"
                  className="text-blue-700 font-bold"
                />
              </div>
            </button>
          );
        })}
      </div>

      {!loading && filtered.length === 0 && (
        <div className="text-center py-8 text-stone-400 text-sm">
          Walang products dito.
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-stone-400 text-sm">
          Loading products…
        </div>
      )}
    </div>
  );
}
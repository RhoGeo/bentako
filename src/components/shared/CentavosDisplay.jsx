import React from "react";

export default function CentavosDisplay({ centavos = 0, className = "", size = "md", showSign = false }) {
  const pesos = centavos / 100;
  const formatted = pesos.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  const sizeClasses = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-2xl",
    "2xl": "text-3xl",
  };

  return (
    <span className={`font-semibold tabular-nums ${sizeClasses[size] || sizeClasses.md} ${className}`}>
      {showSign && centavos > 0 && "+"}₱{formatted}
    </span>
  );
}
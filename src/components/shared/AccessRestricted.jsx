import React from "react";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AccessRestricted({ message = "Access restricted. Kailangan ng permission para dito." }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4">
        <ShieldOff className="w-8 h-8 text-stone-400" />
      </div>
      <h2 className="text-lg font-semibold text-stone-700 mb-2">Hindi pwede dito</h2>
      <p className="text-stone-500 text-sm mb-6 max-w-xs">{message}</p>
      <Link to={createPageUrl("Counter")}>
        <Button variant="outline" className="touch-target">Balik sa Counter</Button>
      </Link>
    </div>
  );
}
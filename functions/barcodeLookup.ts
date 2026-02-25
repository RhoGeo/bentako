import { createClientFromRequest } from "npm:@base44/sdk@0.8.18";
import { jsonOk, jsonFail, jsonFailFromError } from "./_lib/response.ts";
import { normalizeBarcode } from "./_lib/barcode.ts";
import { requireAuth } from "./_lib/auth.ts";

export async function barcodeLookup(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    await requireAuth(base44, req);

    const body = await req.json();
    const store_id = body?.store_id;
    const barcode = normalizeBarcode(body?.barcode || "");
    if (!store_id || !barcode) {
      return jsonFail(400, "BAD_REQUEST", "store_id and barcode required");
    }

    const results = await base44.asServiceRole.entities.Product.filter({
      store_id,
      barcode,
      product_type: "single",
      is_active: true,
    });

    // Variants first: prefer records with parent_id
    const sorted = (results || []).sort((a: any, b: any) => {
      const av = a.parent_id ? 0 : 1;
      const bv = b.parent_id ? 0 : 1;
      return av - bv;
    });

    const product = sorted[0] || null;
    return jsonOk({ product });
  } catch (err) {
    return jsonFailFromError(err);
  }
}

Deno.serve(barcodeLookup);

function formatReceipt(store_id: string, seq: number) {
  const prefix = store_id;
  return `${prefix}-${String(seq).padStart(6, "0")}`;
}

export async function nextReceiptNumber(base44: any, store_id: string): Promise<string> {
  // Best-effort increment (Base44 doesn't expose transactions here)
  const existing = await base44.asServiceRole.entities.ReceiptSequence.filter({ store_id });
  if (!existing?.length) {
    const created = await base44.asServiceRole.entities.ReceiptSequence.create({ store_id, next_seq: 2 });
    return formatReceipt(store_id, 1);
  }
  const rec = existing[0];
  const next = Number(rec.next_seq || 1);
  const receipt = formatReceipt(store_id, next);
  await base44.asServiceRole.entities.ReceiptSequence.update(rec.id, { next_seq: next + 1 });
  return receipt;
}

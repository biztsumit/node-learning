// Tells the stock-ledger trigger (migration 023) why the stock changes that follow happen,
// and who or what caused them. `true` in set_config = only until this transaction ends, so
// the next request using this pooled connection starts clean.
// Call it inside a transaction, before changing stock. Without it, changes are logged as 'manual'.
// userId: only needed when it differs from the logged-in user (withTransaction already set that)
export const setStockContext = async (client, { reason, orderId = null, userId = null, note = null }) => {
  await client.query(
    `SELECT set_config('app.stock_reason', $1, true),
            set_config('app.order_id', $2, true),
            set_config('app.stock_note', $3, true)`,
    [reason, orderId ?? "", note ?? ""]
  );
  if (userId) {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  }
};

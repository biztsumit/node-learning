import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { orderNumbers, ORDER_NUMBER_ALPHABET } from "../src/utils/order-number.ts";
import {
  api, pool, resetDatabase, closeDatabase,
  createUser, createProduct, createAddress, placeOrder
} from "./helpers.js";

beforeEach(resetDatabase);
after(closeDatabase);

const customerWithOrder = async () => {
  const user = await createUser();
  await createAddress(user);
  const mug = await createProduct({ stock: 100 });
  const order = (await placeOrder(user, [[mug.id, 1]])).body.data;
  return { user, mug, order };
};

describe("order numbers", () => {

  it("look like ORD-XXXXXX and never use characters that are easy to confuse", async () => {
    const { order } = await customerWithOrder();
    assert.match(order.orderNumber, /^ORD-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);

    for (const confusing of ["0", "O", "1", "I", "L", "U"]) {
      assert.ok(!ORDER_NUMBER_ALPHABET.includes(confusing), `alphabet contains ${confusing}`);
    }
    for (let i = 0; i < 2000; i++) {
      assert.match(orderNumbers.next(), /^ORD-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    }
  });

  it("are random, not counting", async () => {
    const a = await customerWithOrder();
    const b = await customerWithOrder();
    assert.notEqual(a.order.orderNumber, b.order.orderNumber);
    // Counting numbers would differ by 1; random ones share no pattern
    const generated = new Set(Array.from({ length: 1000 }, () => orderNumbers.next()));
    assert.ok(generated.size > 995);
  });

  it("try another number if the first one is already taken, without breaking the checkout", async () => {
    const first = await customerWithOrder();
    const taken = first.order.orderNumber;

    // Make the generator hand out the taken number first, then a fresh one
    const realNext = orderNumbers.next;
    let calls = 0;
    orderNumbers.next = () => (++calls === 1 ? taken : realNext());
    try {
      const user = await createUser();
      await createAddress(user);
      const res = await placeOrder(user, [[first.mug.id, 1]]);

      assert.equal(res.status, 201);
      assert.equal(calls, 2);
      assert.notEqual(res.body.data.orderNumber, taken);
      assert.equal(res.body.data.items.length, 1);     // the rest of the checkout still happened
    } finally {
      orderNumbers.next = realNext;
    }
  });

  it("can be looked up by the customer, typed however they like", async () => {
    const { user, order } = await customerWithOrder();
    const code = order.orderNumber.slice(4);           // "7K3M9Q"

    for (const typed of [order.orderNumber, order.orderNumber.toLowerCase(), code, ` ${code.toLowerCase()} `]) {
      const res = await api().get(`/orders/number/${encodeURIComponent(typed)}`).set(user.auth).expect(200);
      assert.equal(res.body.data.id, order.id);
    }
  });

  it("only show customers their own orders", async () => {
    const { order } = await customerWithOrder();
    const stranger = await createUser();
    await api().get(`/orders/number/${order.orderNumber}`).set(stranger.auth).expect(404);
  });

  it("reject numbers that can't exist", async () => {
    const user = await createUser();
    await api().get("/orders/number/ORD-0O1IL").set(user.auth).expect(400);    // look-alikes, too short
    await api().get("/orders/number/hello-world").set(user.auth).expect(400);
  });

  it("let admins find an order from a number read out on the phone", async () => {
    const admin = await createUser({ role: "admin" });
    const { order } = await customerWithOrder();
    await customerWithOrder();

    const res = await api().get(`/admin/orders?orderNumber=${order.orderNumber.toLowerCase()}`).set(admin.auth).expect(200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].orderNumber, order.orderNumber);
    assert.equal(res.body.data[0].id, order.id);
  });

  it("are required and unique in the database itself", async () => {
    const { order } = await customerWithOrder();
    const { rows: [{ user_id }] } = await pool.query("SELECT user_id FROM orders WHERE id = $1", [order.id]);

    await assert.rejects(
      pool.query("INSERT INTO orders (user_id, subtotal_amount, total_amount, order_number) VALUES ($1, 1, 1, $2)", [user_id, order.orderNumber]),
      { code: "23505" }
    );
    await assert.rejects(
      pool.query("INSERT INTO orders (user_id, subtotal_amount, total_amount) VALUES ($1, 1, 1)", [user_id]),
      { code: "23502" }
    );
  });
});

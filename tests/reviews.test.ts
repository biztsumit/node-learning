import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  api, pool, resetDatabase, closeDatabase, warmUpPool,
  createUser, createProduct, createAddress, placeOrder, setOrderStatus, type TestUser
} from "./helpers.ts";

beforeEach(resetDatabase);
after(closeDatabase);

// A customer who has received `product`
const customerWhoReceived = async (product) => {
  const user = await createUser();
  await createAddress(user);
  const order = (await placeOrder(user, [[product.id, 1]])).body.data;
  await setOrderStatus(order.id, "delivered");
  return user;
};

const review = (user, product, rating, comment = "") =>
  api().post(`/products/${product.id}/reviews`).set(user.auth).send({ rating, comment });

describe("reviews", () => {

  it("only lets customers review products they've received", async () => {
    const mug = await createProduct();
    const stranger = await createUser();
    await review(stranger, mug, 5).expect(403);

    const buyer = await createUser();
    await createAddress(buyer);
    const order = (await placeOrder(buyer, [[mug.id, 1]])).body.data;
    await review(buyer, mug, 5).expect(403);          // ordered, not delivered yet

    await setOrderStatus(order.id, "delivered");
    await review(buyer, mug, 5).expect(201);
    await review(buyer, mug, 4).expect(409);          // one review each
  });

  it("keeps the product's average and count up to date", async () => {
    const mug = await createProduct();
    const a = await customerWhoReceived(mug);
    const b = await customerWhoReceived(mug);

    await review(a, mug, 5).expect(201);
    await review(b, mug, 2).expect(201);
    let product = (await api().get(`/products/${mug.id}`)).body.data;
    assert.deepEqual(product.rating, { average: 3.5, count: 2 });

    await api().patch(`/products/${mug.id}/reviews/me`).set(b.auth).send({ rating: 4 }).expect(200);
    product = (await api().get(`/products/${mug.id}`)).body.data;
    assert.deepEqual(product.rating, { average: 4.5, count: 2 });

    await api().delete(`/products/${mug.id}/reviews/me`).set(a.auth).expect(200);
    product = (await api().get(`/products/${mug.id}`)).body.data;
    assert.deepEqual(product.rating, { average: 4, count: 1 });
  });

  it("stays correct when many reviews arrive at the same moment", async () => {
    const lamp = await createProduct();
    const ratings = [5, 1, 4, 2, 5, 3];
    const customers: TestUser[] = [];
    for (const _ of ratings) {
      customers.push(await customerWhoReceived(lamp));
    }

    await warmUpPool();
    await Promise.all(customers.map((c, i) => review(c, lamp, ratings[i])));

    const { rows: [stored] } = await pool.query("SELECT rating_avg, rating_count FROM products WHERE id = $1", [lamp.id]);
    assert.equal(stored.rating_count, 6);
    assert.equal(Number(stored.rating_avg), 3.33);
  });

  it("shows a public summary with a star breakdown and short reviewer names", async () => {
    const mug = await createProduct();
    const user = await customerWhoReceived(mug);
    await pool.query("UPDATE users SET name = 'riya sharma' WHERE id = $1", [user.id]);
    await review(user, mug, 4, "Nice").expect(201);

    const res = await api().get(`/products/${mug.id}/reviews`).expect(200);
    assert.deepEqual(res.body.data.summary.breakdown, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 });
    assert.equal(res.body.data.reviews[0].reviewer, "Riya S.");
  });
});

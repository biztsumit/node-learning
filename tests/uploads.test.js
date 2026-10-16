import crypto from "node:crypto";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import { api, resetDatabase, closeDatabase, createUser, createProduct } from "./helpers.js";

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const SECRET = process.env.CLOUDINARY_API_SECRET;

// What Cloudinary's secure_url looks like for an image in our product folder
const ourImageUrl = (format = "jpg") =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1760000000/ecommerce/products/${crypto.randomUUID()}.${format}`;

// Pretend to be Cloudinary's delete API, and remember what we were asked to delete
const realFetch = globalThis.fetch;
let deleted = [];
let cloudinaryDown = false;
before(() => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.cloudinary.com/")) {
      return realFetch(url, options);
    }
    const form = new URLSearchParams(options.body);
    const { signature, api_key, ...signed } = Object.fromEntries(form);
    if (cloudinaryDown) {
      return new Response(JSON.stringify({ error: { message: "Service unavailable" } }), { status: 503 });
    }
    // Reject requests that aren't signed correctly, like the real Cloudinary would
    if (signature !== cloudinary.utils.api_sign_request(signed, SECRET)) {
      return new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
    }
    deleted.push(signed.public_id);
    return new Response(JSON.stringify({ result: "ok" }));
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  await resetDatabase();
  deleted = [];
  cloudinaryDown = false;
});
after(closeDatabase);

const publicIdOf = (url) => url.match(/(ecommerce\/products\/[0-9a-f-]{36})\./)[1];

describe("upload permission (step 1)", () => {

  it("is only for admins", async () => {
    const customer = await createUser();
    await api().post("/admin/uploads/product-image").expect(401);
    await api().post("/admin/uploads/product-image").set(customer.auth).expect(403);
  });

  it("is signed exactly the way Cloudinary checks it, for one file in our folder", async () => {
    const admin = await createUser({ role: "admin" });
    const { body } = await api().post("/admin/uploads/product-image").set(admin.auth).expect(200);
    const { uploadUrl, fields, expiresAt } = body.data;

    assert.equal(uploadUrl, `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    assert.match(fields.public_id, /^ecommerce\/products\/[0-9a-f-]{36}$/);
    assert.equal(fields.allowed_formats, "jpg,png,webp");
    assert.equal(fields.api_key, process.env.CLOUDINARY_API_KEY);

    // Check against Cloudinary's official SDK
    const { signature, api_key, ...signed } = fields;
    assert.equal(signature, cloudinary.utils.api_sign_request(signed, SECRET));

    const minutesLeft = (new Date(expiresAt) - Date.now()) / 60000;
    assert.ok(minutesLeft > 55 && minutesLeft <= 60);
  });

  it("gives every upload its own file name", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await api().post("/admin/uploads/product-image").set(admin.auth);
    const b = await api().post("/admin/uploads/product-image").set(admin.auth);
    assert.notEqual(a.body.data.fields.public_id, b.body.data.fields.public_id);
  });
});

describe("attaching an image (step 3)", () => {

  it("only accepts images from our own Cloudinary product folder", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    const attach = (imageUrl) => api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl });

    await attach("https://picsum.photos/seed/mug/600/600").expect(400);
    await attach(ourImageUrl().replace(CLOUD, "someone-elses-cloud")).expect(400);
    await attach(ourImageUrl().replace("ecommerce/products", "ecommerce/other")).expect(400);
    await attach(ourImageUrl("gif")).expect(400);
    await attach(ourImageUrl()).expect(200);
  });

  it("returns the original and a resized thumbnail", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    const imageUrl = ourImageUrl("png");

    const { body } = await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl }).expect(200);

    assert.equal(body.data.imageUrl, imageUrl);
    assert.equal(body.data.thumbnailUrl, imageUrl.replace("/image/upload/", "/image/upload/c_fill,w_400,h_400,f_auto,q_auto/"));

    const listed = await api().get("/products").expect(200);
    assert.equal(listed.body.data[0].thumbnailUrl, body.data.thumbnailUrl);
  });

  it("is admin-only and 404s for unknown products", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();

    await api().patch(`/products/${product.id}/image`).set(customer.auth).send({ imageUrl: ourImageUrl() }).expect(403);
    await api().patch(`/products/${crypto.randomUUID()}/image`).set(admin.auth).send({ imageUrl: ourImageUrl() }).expect(404);
  });
});

describe("cleaning up old images", () => {

  it("deletes the previous image from Cloudinary when it's replaced or removed", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    const first = ourImageUrl();
    const second = ourImageUrl();
    const attach = (imageUrl) => api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl }).expect(200);

    await attach(first);
    assert.deepEqual(deleted, []);

    await attach(second);
    assert.deepEqual(deleted, [publicIdOf(first)]);

    const removed = await attach(null);
    assert.equal(removed.body.data.imageUrl, null);
    assert.equal(removed.body.data.thumbnailUrl, null);
    assert.deepEqual(deleted, [publicIdOf(first), publicIdOf(second)]);
  });

  it("deletes the image when its product is deleted", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    const imageUrl = ourImageUrl();
    await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl }).expect(200);

    await api().delete(`/products/${product.id}`).set(admin.auth).expect(200);
    assert.deepEqual(deleted, [publicIdOf(imageUrl)]);
  });

  it("never deletes outside images (e.g. replaced through PUT)", async () => {
    const admin = await createUser({ role: "admin" });
    const created = await api().post("/products").set(admin.auth)
      .send({ name: "Mug", price: 100, imageUrl: "https://picsum.photos/seed/mug/600/600" }).expect(201);

    await api().patch(`/products/${created.body.data.id}/image`).set(admin.auth).send({ imageUrl: ourImageUrl() }).expect(200);
    assert.deepEqual(deleted, []);
  });

  it("still saves the change if Cloudinary can't delete the old file", async () => {
    const admin = await createUser({ role: "admin" });
    const product = await createProduct();
    await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl: ourImageUrl() }).expect(200);

    cloudinaryDown = true;
    const replacement = ourImageUrl();
    const res = await api().patch(`/products/${product.id}/image`).set(admin.auth).send({ imageUrl: replacement }).expect(200);
    assert.equal(res.body.data.imageUrl, replacement);
  });
});

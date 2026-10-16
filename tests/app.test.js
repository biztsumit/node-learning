// Things every response should get: security headers, CORS rules, request ids, clean errors
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, closeDatabase } from "./helpers.js";

after(closeDatabase);

describe("health check", () => {

  it("reports ok when the database is reachable", async () => {
    const res = await api().get("/health").expect(200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.database, "ok");
  });
});

describe("every response", () => {

  it("has security headers and no X-Powered-By", async () => {
    const res = await api().get("/").expect(200);
    assert.equal(res.headers["x-powered-by"], undefined);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["strict-transport-security"]);
  });

  it("has a request id, and reuses a safe one sent by the client", async () => {
    const generated = await api().get("/");
    assert.match(generated.headers["x-request-id"], /^[0-9a-f-]{36}$/);

    const passed = await api().get("/").set("X-Request-Id", "my-trace-1");
    assert.equal(passed.headers["x-request-id"], "my-trace-1");

    const unsafe = await api().get("/").set("X-Request-Id", "<script>");
    assert.notEqual(unsafe.headers["x-request-id"], "<script>");
  });

  it("only allows listed websites through CORS", async () => {
    const allowed = await api().get("/products").set("Origin", "http://localhost:5173");
    assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");

    const other = await api().get("/products").set("Origin", "https://evil.example");
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });

  it("answers unknown routes and broken JSON with clean JSON errors", async () => {
    const missing = await api().get("/nope").expect(404);
    assert.equal(missing.body.success, false);

    await api().post("/auth/login").set("Content-Type", "application/json").send("{\"email\":").expect(400);
  });
});

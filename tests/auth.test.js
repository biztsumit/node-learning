import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, pool, resetDatabase, closeDatabase, createUser } from "./helpers.js";

beforeEach(resetDatabase);
after(closeDatabase);

describe("register and login", () => {

  it("registers a user, normalises the email and never returns the password hash", async () => {
    const res = await api()
      .post("/auth/register")
      .send({ name: "  Riya  ", email: "  Riya@Example.COM ", password: "secret123", role: "admin" })
      .expect(201);

    assert.equal(res.body.data.user.email, "riya@example.com");
    assert.equal(res.body.data.user.name, "Riya");
    assert.equal(res.body.data.user.role, "user");            // "role" in the body is ignored
    assert.equal(res.body.data.user.password_hash, undefined);
    assert.ok(res.body.data.token);
  });

  it("rejects a second account with the same email", async () => {
    const body = { name: "A", email: "same@example.com", password: "secret123" };
    await api().post("/auth/register").send(body).expect(201);
    const res = await api().post("/auth/register").send({ ...body, email: "SAME@example.com" }).expect(409);
    assert.equal(res.body.message, "Email is already registered");
  });

  it("lists every validation problem at once", async () => {
    const res = await api().post("/auth/register").send({ email: "nope", password: "123" }).expect(400);
    const fields = res.body.errors.map((e) => e.field).sort();
    assert.deepEqual(fields, ["email", "name", "password"]);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const user = await createUser();
    const wrongPassword = await api().post("/auth/login").send({ email: user.email, password: "wrong" }).expect(401);
    const unknownEmail = await api().post("/auth/login").send({ email: "nobody@example.com", password: "wrong" }).expect(401);
    assert.equal(wrongPassword.body.message, unknownEmail.body.message);
  });

  it("refuses requests without a valid token", async () => {
    await api().get("/auth/me").expect(401);
    await api().get("/auth/me").set("Authorization", "Bearer not.a.token").expect(401);
  });
});

describe("sessions", () => {

  it("changing the password logs out every old token but returns a new one", async () => {
    const user = await createUser();
    const otherDevice = (await api().post("/auth/login").send({ email: user.email, password: user.password })).body.data.token;

    await api()
      .post("/auth/change-password")
      .set(user.auth)
      .send({ currentPassword: "wrong", newPassword: "newpass123" })
      .expect(400);

    const res = await api()
      .post("/auth/change-password")
      .set(user.auth)
      .send({ currentPassword: user.password, newPassword: "newpass123" })
      .expect(200);

    await api().get("/auth/me").set(user.auth).expect(401);
    await api().get("/auth/me").set("Authorization", `Bearer ${otherDevice}`).expect(401);
    await api().get("/auth/me").set("Authorization", `Bearer ${res.body.data.token}`).expect(200);
    await api().post("/auth/login").send({ email: user.email, password: "newpass123" }).expect(200);
  });

  it("treats tokens from before the UUID switch (numeric userId) as ended sessions", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const oldToken = jwt.sign({ userId: 1, tokenVersion: 0 }, process.env.JWT_SECRET ?? (await import("../src/config/env.js")).env.JWT_SECRET);
    const res = await api().get("/auth/me").set("Authorization", `Bearer ${oldToken}`).expect(401);
    assert.match(res.body.message, /session has ended/);
  });

  it("logout-all ends every session", async () => {
    const user = await createUser();
    await api().post("/auth/logout-all").set(user.auth).expect(200);
    await api().get("/auth/me").set(user.auth).expect(401);
  });

  it("reads the role from the database, so promotions apply to existing tokens", async () => {
    const user = await createUser();
    await api().get("/admin/orders").set(user.auth).expect(403);

    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    await api().get("/admin/orders").set(user.auth).expect(200);
  });

  it("only lets the name be changed on the profile", async () => {
    const user = await createUser();
    const res = await api()
      .patch("/auth/me")
      .set(user.auth)
      .send({ name: "New Name", email: "hijack@example.com", role: "admin" })
      .expect(200);

    assert.equal(res.body.data.name, "New Name");
    assert.equal(res.body.data.email, user.email);
    assert.equal(res.body.data.role, "user");
  });
});

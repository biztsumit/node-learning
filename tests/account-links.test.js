import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { sentEmails } from "../src/emails/transport.ts";
import { hashToken } from "../src/services/auth-token.services.ts";
import { api, pool, resetDatabase, closeDatabase, warmUpPool, createUser } from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
  sentEmails.length = 0;
});
after(closeDatabase);

// The token from the link in the latest email with this subject, like a person clicking it
const tokenFromEmail = (subject, to) => {
  const email = sentEmails.findLast((e) => e.subject === subject && (!to || e.to === to));
  assert.ok(email, `no "${subject}" email`);
  return new URL(email.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
};
const resetToken = (to) => tokenFromEmail("Reset your password", to);
const verifyToken = (to) => tokenFromEmail("Please confirm your email address", to);

const forgot = (email) => api().post("/auth/forgot-password").send({ email });
const reset = (token, newPassword = "brand-new-pass") => api().post("/auth/reset-password").send({ token, newPassword });
const login = (email, password) => api().post("/auth/login").send({ email, password });

describe("forgot password", () => {

  it("gives the same answer whether or not the email has an account", async () => {
    const user = await createUser();
    sentEmails.length = 0;

    const known = await forgot(user.email).expect(200);
    const unknown = await forgot("nobody@example.com").expect(200);

    assert.equal(known.body.message, unknown.body.message);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, user.email);
  });

  it("resets the password with the emailed link, and logs out every device", async () => {
    const user = await createUser();
    await forgot(user.email).expect(200);
    const token = resetToken(user.email);

    // The link points at the reset page, with a long random token
    assert.match(sentEmails.at(-1).text, /\/reset-password\?token=[A-Za-z0-9_-]{43}/);

    await reset(token, "brand-new-pass").expect(200);

    await login(user.email, user.password).expect(401);
    await login(user.email, "brand-new-pass").expect(200);
    await api().get("/auth/me").set(user.auth).expect(401);     // the old session ended
  });

  it("works only once", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = resetToken(user.email);

    await reset(token, "first-new-pass").expect(200);
    const again = await reset(token, "second-new-pass").expect(400);
    assert.match(again.body.message, /invalid, has already been used, or has expired/);
    await login(user.email, "first-new-pass").expect(200);
  });

  it("works only once even when the link is used twice at the same moment", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = resetToken(user.email);

    await warmUpPool();
    const results = await Promise.all([reset(token, "attempt-one"), reset(token, "attempt-two")]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it("expires after an hour", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = resetToken(user.email);
    await pool.query("UPDATE auth_tokens SET expires_at = NOW() - INTERVAL '1 second'");

    await reset(token).expect(400);
  });

  it("only the newest link works", async () => {
    const user = await createUser();
    await forgot(user.email);
    const older = resetToken(user.email);
    await forgot(user.email);
    const newer = resetToken(user.email);

    await reset(older).expect(400);
    await reset(newer).expect(200);
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = resetToken(user.email);

    const { rows } = await pool.query("SELECT token_hash FROM auth_tokens WHERE purpose = 'password_reset'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hashToken(token));
    assert.notEqual(rows[0].token_hash, token);
    const anywhere = await pool.query("SELECT COUNT(*)::int AS n FROM auth_tokens WHERE token_hash = $1", [token]);
    assert.equal(anywhere.rows[0].n, 0);
  });

  it("rejects made-up tokens", async () => {
    await reset("x".repeat(43)).expect(400);
    await reset("short").expect(400);
  });
});

describe("email verification", () => {

  it("emails a link when you register, and the link verifies your address", async () => {
    const user = await createUser();
    const before = await api().get("/auth/me").set(user.auth).expect(200);
    assert.equal(before.body.data.email_verified, false);

    await api().post("/auth/verify-email").send({ token: verifyToken(user.email) }).expect(200);

    const after = await api().get("/auth/me").set(user.auth).expect(200);
    assert.equal(after.body.data.email_verified, true);
  });

  it("can't be done with a password-reset token (each token has one purpose)", async () => {
    const user = await createUser();
    await forgot(user.email);
    await api().post("/auth/verify-email").send({ token: resetToken(user.email) }).expect(400);
  });

  it("can send a new link (logged in), and says so if you're already verified", async () => {
    const user = await createUser();
    await api().post("/auth/resend-verification").expect(401);
    await api().post("/auth/resend-verification").set(user.auth).expect(200);

    const older = sentEmails.filter((e) => e.subject === "Please confirm your email address" && e.to === user.email);
    assert.equal(older.length, 2);

    await api().post("/auth/verify-email").send({ token: verifyToken(user.email) }).expect(200);
    await api().post("/auth/resend-verification").set(user.auth).expect(409);
  });

  it("treats a completed password reset as proof of the email address too", async () => {
    const user = await createUser();
    await forgot(user.email);
    await reset(resetToken(user.email), "new-pass-123").expect(200);

    const token = (await login(user.email, "new-pass-123")).body.data.token;
    const me = await api().get("/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(me.body.data.email_verified, true);
  });
});

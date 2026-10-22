import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, pool, resetDatabase, closeDatabase, createUser, type TestUser } from "./helpers.ts";
import { base32Decode, timeStep, totpAt } from "../src/utils/totp.ts";
import { env } from "../src/config/env.ts";

beforeEach(resetDatabase);
after(closeDatabase);

// ---------- Helpers ----------

type Response = { headers: Record<string, unknown> };

// The refresh_token cookie a response set ("refresh_token=abc; Path=/auth; HttpOnly; ...")
const setCookie = (res: Response): string | undefined => {
  const header = res.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : [];
  return cookies.find((c: string) => c.startsWith("refresh_token="));
};

// Just "refresh_token=abc", as a browser would send it back
const cookieOf = (res: Response): string => {
  const full = setCookie(res);
  assert.ok(full, "the response sets the refresh cookie");
  return full.split(";")[0] ?? "";
};

const login = (user: TestUser) => api().post("/auth/login").send({ email: user.email, password: user.password });
const refresh = (cookie: string) => api().post("/auth/refresh").set("Cookie", cookie);

// The code an authenticator app would show right now (or `stepsAhead` periods later)
const codeFor = (secret: string, stepsAhead = 0): string =>
  totpAt(base32Decode(secret), timeStep(Date.now() / 1000) + stepsAhead);

// Turns on 2FA for a user; returns the secret and recovery codes
const enableTwoFactor = async (user: TestUser) => {
  const setup = await api().post("/auth/2fa/setup").set(user.auth).expect(200);
  const secret: string = setup.body.data.secret;
  const enabled = await api().post("/auth/2fa/enable").set(user.auth).send({ code: codeFor(secret) }).expect(200);
  return { secret, recoveryCodes: enabled.body.data.recoveryCodes as string[] };
};

// ---------- Refresh tokens ----------

describe("refresh tokens", () => {

  it("are set as an httpOnly cookie, only for /auth, and only their hash is stored", async () => {
    const user = await createUser();
    const res = await login(user).expect(200);

    const cookie = setCookie(res);
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\/auth/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(res.body.data.accessTokenExpiresIn, "15m");

    const raw = cookieOf(res).split("=")[1] ?? "";
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE token_hash = $1", [raw]);
    assert.equal(rows[0].n, 0, "the raw token is never stored");
  });

  it("give a new access token AND a new refresh token each time", async () => {
    const user = await createUser();
    const first = cookieOf(await login(user).expect(200));

    const res = await refresh(first).expect(200);
    const second = cookieOf(res);
    assert.notEqual(second, first);
    await api().get("/auth/me").set("Authorization", `Bearer ${res.body.data.token}`).expect(200);
    await refresh(second).expect(200);
    await api().post("/auth/refresh").expect(401);    // no cookie at all
  });

  it("end the whole session when an old one is used again (it was copied)", async () => {
    const user = await createUser();
    const stolen = cookieOf(await login(user).expect(200));
    const current = cookieOf(await refresh(stolen).expect(200));   // the real user moves on

    // Later (after the two-tabs grace period), the thief tries the old copy
    await pool.query("UPDATE refresh_tokens SET used_at = NOW() - INTERVAL '1 minute' WHERE used_at IS NOT NULL");
    const res = await refresh(stolen).expect(401);
    assert.match(String(setCookie(res)), /refresh_token=;/, "the browser is told to drop the cookie");

    // ...and the session is over for everyone: the newest token is dead too
    await refresh(current).expect(401);
  });

  it("forgive two tabs refreshing at the same moment", async () => {
    const user = await createUser();
    const cookie = cookieOf(await login(user).expect(200));
    const winner = cookieOf(await refresh(cookie).expect(200));
    await refresh(cookie).expect(409);           // the other tab, a moment later
    await refresh(winner).expect(200);           // the session lives on
  });

  it("stop working after logout, log-out-everywhere, or a password change", async () => {
    const user = await createUser();

    const onThisDevice = cookieOf(await login(user).expect(200));
    const res = await api().post("/auth/logout").set("Cookie", onThisDevice).expect(200);
    assert.match(String(setCookie(res)), /refresh_token=;/);
    await refresh(onThisDevice).expect(401);

    const phone = cookieOf(await login(user).expect(200));
    await api().post("/auth/logout-all").set(user.auth).expect(200);
    await refresh(phone).expect(401);

    const fresh = await login(user).expect(200);
    const laptop = cookieOf(await login(user).expect(200));
    await api().post("/auth/change-password").set("Authorization", `Bearer ${fresh.body.data.token}`)
      .send({ currentPassword: user.password, newPassword: "brand-new-pass" }).expect(200);
    await refresh(laptop).expect(401);
  });

  it("can't be used from a website that isn't allowed", async () => {
    const user = await createUser();
    const cookie = cookieOf(await login(user).expect(200));
    await refresh(cookie).set("Origin", "https://evil.example").expect(403);
    await refresh(cookie).set("Origin", "http://localhost:5173").expect(200);
  });
});

// ---------- Two-factor login ----------

describe("two-factor login", () => {

  it("is turned on with a working code, and gives one-time recovery codes", async () => {
    const user = await createUser();
    const setup = await api().post("/auth/2fa/setup").set(user.auth).expect(200);
    const { secret, otpauthUrl } = setup.body.data;
    assert.match(otpauthUrl, /^otpauth:\/\/totp\//);

    await api().post("/auth/2fa/enable").set(user.auth).send({ code: "000000" }).expect(400);
    const enabled = await api().post("/auth/2fa/enable").set(user.auth).send({ code: codeFor(secret) }).expect(200);
    assert.equal(enabled.body.data.recoveryCodes.length, 10);

    const status = await api().get("/auth/2fa").set(user.auth).expect(200);
    assert.deepEqual(status.body.data, { enabled: true, recoveryCodesLeft: 10 });

    // The secret is stored encrypted, and never written to the audit log
    const { rows: [stored] } = await pool.query("SELECT totp_secret FROM users WHERE id = $1", [user.id]);
    assert.notEqual(stored.totp_secret, secret);
    const { rows: [leak] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM audit_log WHERE changes::text LIKE '%' || $1 || '%' OR changes::text LIKE '%' || $2 || '%'",
      [secret, stored.totp_secret]
    );
    assert.equal(leak.n, 0);
  });

  it("makes login a two-step process; the first step alone gives no access", async () => {
    const user = await createUser();
    const { secret } = await enableTwoFactor(user);

    const first = await login(user).expect(200);
    assert.equal(first.body.data.twoFactorRequired, true);
    assert.equal(first.body.data.token, undefined);
    assert.equal(setCookie(first), undefined, "no session yet");

    // The challenge is a signed token too, but it must not work as an access token
    const challengeToken: string = first.body.data.challengeToken;
    await api().get("/auth/me").set("Authorization", `Bearer ${challengeToken}`).expect(401);

    await api().post("/auth/login/2fa").send({ challengeToken, code: "123456" }).expect(401);
    // (the code used to turn 2FA on was this period's: the next period's code works)
    const second = await api().post("/auth/login/2fa").send({ challengeToken, code: codeFor(secret, 1) }).expect(200);
    assert.ok(setCookie(second));
    await api().get("/auth/me").set("Authorization", `Bearer ${second.body.data.token}`).expect(200);
  });

  it("refuses a code that was already used (no replays)", async () => {
    const user = await createUser();
    const { secret } = await enableTwoFactor(user);   // used this period's code

    const { challengeToken } = (await login(user).expect(200)).body.data;
    await api().post("/auth/login/2fa").send({ challengeToken, code: codeFor(secret) }).expect(401);
  });

  it("accepts each recovery code once", async () => {
    const user = await createUser();
    const { recoveryCodes } = await enableTwoFactor(user);
    const [code = ""] = recoveryCodes;

    // A fresh login (first step) for each try
    const challenge = async (): Promise<string> => (await login(user).expect(200)).body.data.challengeToken;

    await api().post("/auth/login/2fa").send({ challengeToken: await challenge(), code: code.toUpperCase().replace("-", " ") }).expect(200);   // typed loosely: still fine
    await api().post("/auth/login/2fa").send({ challengeToken: await challenge(), code }).expect(401);                                       // but only once
    const status = await api().get("/auth/2fa").set(user.auth).expect(200);
    assert.equal(status.body.data.recoveryCodesLeft, 9);
  });

  it("needs the password AND a code to turn off", async () => {
    const user = await createUser();
    const { secret } = await enableTwoFactor(user);

    await api().post("/auth/2fa/disable").set(user.auth).send({ password: "wrong", code: codeFor(secret, 1) }).expect(400);
    await api().post("/auth/2fa/disable").set(user.auth).send({ password: user.password, code: "999999" }).expect(400);
    await api().post("/auth/2fa/disable").set(user.auth).send({ password: user.password, code: codeFor(secret, 1) }).expect(200);
    await login(user).expect(200).then((res) => assert.ok(res.body.data.token));
  });

  it("can be required for admins (REQUIRE_ADMIN_2FA)", async () => {
    const admin = await createUser({ role: "admin" });
    env.REQUIRE_ADMIN_2FA = true;
    try {
      await api().get("/admin/orders").set(admin.auth).expect(403);    // password-only login

      const { secret } = await enableTwoFactor(admin);                 // setup works without 2FA
      const { challengeToken } = (await login(admin).expect(200)).body.data;
      const withCode = await api().post("/auth/login/2fa").send({ challengeToken, code: codeFor(secret, 1) }).expect(200);
      await api().get("/admin/orders").set("Authorization", `Bearer ${withCode.body.data.token}`).expect(200);

      // A refresh keeps the "passed two-factor" mark
      const refreshed = await refresh(cookieOf(withCode)).expect(200);
      await api().get("/admin/orders").set("Authorization", `Bearer ${refreshed.body.data.token}`).expect(200);
    } finally {
      env.REQUIRE_ADMIN_2FA = false;
    }
  });
});

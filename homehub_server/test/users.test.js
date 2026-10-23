"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  displayNameFromEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  publicUser
} = require("../src/users");

test("email registration fields are normalized for local accounts", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail("", { required: false }), "");
  assert.equal(normalizeDisplayName("  小鹿  ", "fallback"), "小鹿");
  assert.equal(normalizeDisplayName("", displayNameFromEmail("user@example.com")), "user");
  assert.equal(normalizePassword("123456"), "123456");
  assert.throws(() => normalizeEmail("not-an-email"), /invalid email/);
  assert.throws(() => normalizePassword("12345"), /at least 6/);
});

test("public user payload does not expose password hash", () => {
  assert.deepEqual(
    publicUser({
      id: 7,
      login: "user@example.com",
      email: "user@example.com",
      display_name: "User",
      role: "member",
      password_hash: "secret",
      created_at: "2026-07-03T00:00:00.000Z",
      food_count: 3,
      device_count: 1
    }),
    {
      id: 7,
      login: "user@example.com",
      email: "user@example.com",
      displayName: "User",
      role: "member",
      isAdmin: false,
      createdAt: "2026-07-03T00:00:00.000Z",
      foodCount: 3,
      deviceCount: 1
    }
  );
});

test("self-service display name editing is wired end to end", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ROOT = path.resolve(__dirname, "..");
  const server = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  assert.match(server, /url\.pathname === "\/api\/users\/me"/);
  assert.match(server, /const displayName = normalizeDisplayName\(body\.displayName, user\.login\)/);
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.match(html, /id="displayNameForm"/);
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.match(app, /async function saveDisplayName/);
  assert.match(app, /api\("\/api\/users\/me"/);
  assert.match(app, /method: "PATCH"/);
});

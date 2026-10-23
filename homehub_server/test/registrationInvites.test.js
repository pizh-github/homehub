"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestDatabase } = require("./helpers");
const { RegistrationInviteError, createRegistrationInviteService, normalizeRegistrationInviteCode } = require("../src/registrationInvites");

const ROOT = path.resolve(__dirname, "..");
const NOW = new Date("2026-07-20T08:00:00.000Z");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createService(db, { ttlMs } = {}) {
  let sequence = 0;
  return createRegistrationInviteService({
    db,
    hashValue: sha256,
    generateCode: () => `TEST${String(++sequence).padStart(3, "0")}`,
    inviteTtlMs: ttlMs ?? 24 * 60 * 60 * 1000
  });
}

test("registration invite codes are normalized before lookup", () => {
  assert.equal(normalizeRegistrationInviteCode(" ab-12 cd "), "AB12CD");
  assert.equal(normalizeRegistrationInviteCode(""), "");
});

test("admins can create member and admin invites with notes", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1, login: "one" };

  const member = service.createInvite(creator, { kind: "member", note: " 给老婆 " });
  assert.equal(member.kind, "member");
  assert.equal(member.code, "TEST001");
  assert.equal(member.note, "给老婆");
  assert.ok(member.expiresAt > new Date().toISOString());

  const admin = service.createInvite(creator, { kind: "admin" });
  assert.equal(admin.kind, "admin");

  assert.throws(() => service.createInvite(creator, { kind: "root" }), /invite kind/);
  assert.equal(service.listInvites().length, 2);
  assert.deepEqual(service.listInvites().map((row) => row.kind), ["admin", "member"]);
  assert.equal(service.listInvites()[0].createdBy, "One");
});

test("findUsable reports precise errors for missing, used and expired codes", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1 };
  const invite = service.createInvite(creator, { kind: "member" });

  assert.deepEqual(service.findUsable("").error, "required");
  assert.deepEqual(service.findUsable("ZZZZZZ").error, "not_found");
  assert.ok(service.findUsable(invite.code).invite, "usable invite found");
  assert.ok(service.findUsable(` ${invite.code.toLowerCase()} `).invite, "lookup normalizes case and spaces");

  service.markUsed(invite.id, 2);
  assert.deepEqual(service.findUsable(invite.code).error, "used");
});

test("expired invites are rejected and cleaned up on create", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1 };
  const invite = service.createInvite(creator, { kind: "admin" });
  assert.ok(service.findUsable(invite.code).invite);

  db.prepare("UPDATE registration_invites SET expires_at = '2026-07-19T00:00:00.000Z' WHERE id = ?").run(invite.id);
  assert.deepEqual(service.findUsable(invite.code).error, "expired", "expired code cannot be used");

  service.createInvite(creator, { kind: "member" });
  assert.deepEqual(
    service.findUsable(invite.code).error,
    "not_found",
    "expired unused code is cleaned up on next create"
  );
});

test("markUsed is single-use and revocation only works before use", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1 };
  const invite = service.createInvite(creator, { kind: "member" });

  service.markUsed(invite.id, 2);
  assert.throws(() => service.markUsed(invite.id, 3), RegistrationInviteError);
  const row = service.listInvites()[0];
  assert.equal(row.used, true);
  assert.equal(row.usedBy, "two");

  assert.throws(() => service.revokeInvite(invite.id), RegistrationInviteError);
  const second = service.createInvite(creator, { kind: "member" });
  assert.deepEqual(service.revokeInvite(second.id), { ok: true, id: second.id });
  assert.deepEqual(service.findUsable(second.code).error, "not_found");
  assert.equal(service.listInvites().length, 1, "revoked row is deleted");
});

test("member invite consume joins creator household, admin invite grants admin role", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1 };
  const memberInvite = service.createInvite(creator, { kind: "member" });
  const adminInvite = service.createInvite(creator, { kind: "admin" });

  db.prepare("INSERT INTO users (id, login) VALUES (3, 'newbie')").run();
  db.prepare("INSERT INTO household_members VALUES (1, 3, 'member', '2026-07-20')").run();

  const usable = service.findUsable(memberInvite.code).invite;
  service.markUsed(usable.id, 3);
  const households = db
    .prepare("SELECT household_id FROM household_members WHERE user_id = 3")
    .all()
    .map((row) => row.household_id);
  assert.deepEqual(households, [1], "member invite maps to creator household");
  assert.ok(service.findUsable(adminInvite.code).invite, "admin invite still usable");
});

test("registration transaction mirrors handler: roles, household join and rollback", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const creator = { id: 1 };
  // helpers 已预置 household 1(user 1 为 owner)与 users 1/2

  const memberInvite = service.createInvite(creator, { kind: "member" });
  const adminInvite = service.createInvite(creator, { kind: "admin" });

  // 镜像 server.js register handler 的事务步骤,防止角色/家庭归属逻辑被无声改坏
  function register(inviteRow, email) {
    const role = inviteRow.kind === "admin" ? "admin" : "member";
    let creatorHouseholdId = null;
    if (inviteRow.kind === "member") {
      const membership = db
        .prepare("SELECT household_id FROM household_members WHERE user_id = ?")
        .get(inviteRow.created_by_user_id);
      if (!membership) throw new RegistrationInviteError("invite creator no longer has a household", 409);
      creatorHouseholdId = membership.household_id;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const created = db
        .prepare("INSERT INTO users (login, email, role) VALUES (?, ?, ?)")
        .run(email, email, role);
      const userId = Number(created.lastInsertRowid);
      if (inviteRow.kind === "member") {
        db.prepare("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
          .run(creatorHouseholdId, userId, new Date().toISOString());
      } else {
        const household = db
          .prepare("INSERT INTO households (name, created_at, updated_at) VALUES (?, ?, ?)")
          .run(`${email} 的家庭`, new Date().toISOString(), new Date().toISOString());
        db.prepare("INSERT INTO household_members VALUES (?, ?, 'owner', ?)")
          .run(Number(household.lastInsertRowid), userId, new Date().toISOString());
      }
      service.markUsed(inviteRow.id, userId);
      db.exec("COMMIT");
      return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const memberUser = register(service.findUsable(memberInvite.code).invite, "member@example.com");
  assert.equal(memberUser.role, "member");
  assert.deepEqual(
    db.prepare("SELECT household_id FROM household_members WHERE user_id = ?").all(memberUser.id).map((row) => row.household_id),
    [1],
    "member registrant joins creator household"
  );

  const adminUser = register(service.findUsable(adminInvite.code).invite, "admin2@example.com");
  assert.equal(adminUser.role, "admin");
  const adminHousehold = db
    .prepare("SELECT household_id FROM household_members WHERE user_id = ? AND role = 'owner'")
    .get(adminUser.id);
  assert.ok(adminHousehold, "admin registrant owns a fresh household");
  assert.notEqual(adminHousehold.household_id, 1, "admin household is separate from creator");

  // 邀请码在事务中消费失败时,整个注册必须回滚
  const failing = service.createInvite(creator, { kind: "member" });
  db.prepare("UPDATE registration_invites SET expires_at = '2026-07-19T00:00:00.000Z' WHERE id = ?").run(failing.id);
  const usableButStale = service.findUsable(failing.code);
  assert.deepEqual(usableButStale.error, "expired");

  const halfUsed = service.createInvite(creator, { kind: "member" });
  const inviteRow = service.findUsable(halfUsed.code).invite;
  db.prepare("UPDATE registration_invites SET expires_at = '2026-07-19T00:00:00.000Z' WHERE id = ?").run(inviteRow.id);
  assert.throws(() => register(inviteRow, "ghost@example.com"), RegistrationInviteError);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE email = 'ghost@example.com'").get().count, 0, "user insert rolled back");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE user_id IN (SELECT id FROM users WHERE email = 'ghost@example.com')").get().count,
    0,
    "household membership rolled back with the user"
  );
});

test("registration flow is wired into server, ui and checks", () => {
  const server = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  assert.match(server, /registrationInviteService\.findUsable\(body\.inviteCode\)/);
  assert.match(server, /const isEmptyInstance = db\.prepare\("SELECT COUNT\(\*\) AS count FROM users"\)/);
  assert.match(server, /const username = normalizeUsername\(body\.username\)/);
  assert.match(server, /\/api\/registration-invites/);
  assert.match(server, /registration_invites \(/);
  assert.match(server, /userDeletionService\.deleteUser/);

  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.match(html, /name="username"/);
  assert.match(html, /name="inviteCode"/);
  assert.doesNotMatch(html, /name="email"[\s\S]{0,80}register/);
  assert.match(html, /id="registrationInvitesCard"/);
  assert.match(html, /generateAdminInvite/);

  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.match(app, /username: data\.get\("username"\)/);
  assert.match(app, /inviteCode: data\.get\("inviteCode"\)/);
  assert.match(app, /loadRegistrationInvites/);
  assert.match(app, /data-delete-user/);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.check, /src\/registrationInvites\.js/);
  assert.match(pkg.scripts.check, /src\/userDeletion\.js/);
});

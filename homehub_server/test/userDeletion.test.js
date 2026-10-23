"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestDatabase } = require("./helpers");
const { createFitnessService } = require("../src/fitness");
const { UserDeletionError, createUserDeletionService } = require("../src/userDeletion");

const OPERATOR = { id: 1, role: "admin" };

test("deleting a solo member removes the account, household and its items", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  db.prepare(`
    INSERT INTO food_items (household_id, name, category, quantity_text, expires_on, created_at, updated_at)
    VALUES (2, '牛奶', '乳品', '1 瓶', '2026-08-01', '2026-07-01', '2026-07-01')
  `).run();

  const result = service.deleteUser(OPERATOR, 2);
  assert.equal(result.id, 2);
  assert.equal(result.login, "two");
  assert.equal(result.displayName, "Two");
  assert.equal(result.householdsRemoved, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 2").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM households WHERE id = 2").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE household_id = 2").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE user_id = 2").get().count, 0);
});

test("deleting a member of a shared household keeps the household and its data", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  db.prepare("INSERT INTO users (id, login, display_name, role) VALUES (3, 'three', 'Three', 'member')").run();
  db.prepare("INSERT INTO household_members VALUES (1, 3, 'member', '2026-07-01')").run();
  db.prepare(`
    INSERT INTO food_items (household_id, name, category, quantity_text, expires_on, created_at, updated_at)
    VALUES (1, '鸡蛋', '蛋类', '6 个', '2026-08-01', '2026-07-01', '2026-07-01')
  `).run();

  const result = service.deleteUser(OPERATOR, 3);
  assert.equal(result.householdsRemoved, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 3").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM households WHERE id = 1").get().count, 1, "shared household survives");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 1").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE household_id = 1").get().count, 1);
});

test("deleting clears sessions, tokens and registration invite usage", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('hash', 2, '2027-01-01', '2026-07-01')").run();
  db.prepare(`
    INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, expires_at, created_at)
    VALUES (2, 'codex', 'th', 'xzt_', '2027-01-01', '2026-07-01')
  `).run();
  db.prepare(`
    INSERT INTO registration_invites (created_by_user_id, kind, code_hash, note, expires_at, used_by_user_id, used_at, created_at)
    VALUES (1, 'member', 'invitehash', '', '2026-08-01', 2, '2026-07-01', '2026-07-01')
  `).run();

  const result = service.deleteUser(OPERATOR, 2);
  assert.equal(result.householdsRemoved, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = 2").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = 2").get().count, 0);
  const invite = db.prepare("SELECT used_by_user_id, used_at FROM registration_invites WHERE code_hash = 'invitehash'").get();
  assert.equal(invite.used_at, "2026-07-01", "invite audit row is kept");
  assert.equal(invite.used_by_user_id, null, "invitee reference is cleared");
});

test("deleting a user cascades all fitness data", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  const fitness = createFitnessService({ db, today: () => "2026-07-20" });

  db.prepare("INSERT INTO users (id, login, display_name, role) VALUES (3, 'three', 'Three', 'member')").run();
  db.prepare("INSERT INTO household_members VALUES (1, 3, 'member', '2026-07-01')").run();
  fitness.createExercise(3, { name: "跑步", type: "aerobic", defaultDurationMin: 30 });
  fitness.startDay(3, "2026-07-20");
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM fitness_exercises WHERE user_id = 3").get().count > 0);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM fitness_workout_days WHERE user_id = 3").get().count > 0);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM fitness_aerobic_results").get().count > 0);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM fitness_settings WHERE user_id = 3").get().count > 0);

  service.deleteUser(OPERATOR, 3);
  for (const table of ["fitness_exercises", "fitness_workout_days", "fitness_settings"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = 3`).get().count, 0, `${table} cleaned`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM fitness_aerobic_results").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM fitness_set_results").get().count, 0);
});

test("super admin can delete an admin together with its whole household", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
  db.prepare("INSERT INTO users (id, login, display_name, role) VALUES (3, 'admin2', 'Admin2', 'admin')").run();
  db.prepare("INSERT INTO users (id, login, display_name, role) VALUES (4, 'member4', 'Member4', 'member')").run();
  db.prepare("INSERT INTO households (id, name, created_at, updated_at) VALUES (3, 'Admin2的家庭', '2026-07-01', '2026-07-01')").run();
  db.prepare("INSERT INTO household_members VALUES (3, 3, 'owner', '2026-07-01')").run();
  db.prepare("INSERT INTO household_members VALUES (3, 4, 'member', '2026-07-01')").run();
  db.prepare(`
    INSERT INTO food_items (household_id, name, category, quantity_text, expires_on, created_at, updated_at)
    VALUES (3, '牛奶', '乳品', '1 瓶', '2026-08-01', '2026-07-01', '2026-07-01')
  `).run();

  assert.equal(service.isSuperAdmin({ id: 1, role: "admin" }), true, "adminLogin account is the super admin");
  assert.equal(service.isSuperAdmin({ id: 3, role: "admin" }), false);

  const result = service.deleteUser({ id: 1, role: "admin" }, 3);
  assert.equal(result.role, "admin");
  assert.equal(result.householdsRemoved, 1);
  assert.equal(result.deletedUserCount, 2, "admin plus household members");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id IN (3, 4)").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM households WHERE id = 3").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = 3").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE household_id = 3").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2, "super admin and unrelated user stay");
});

test("regular admins cannot delete administrators", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id IN (1, 2)").run();
  db.prepare("INSERT INTO users (id, login, display_name, role) VALUES (3, 'admin3', 'Admin3', 'admin')").run();

  assert.throws(
    () => service.deleteUser({ id: 2, role: "admin" }, 3),
    /only the super administrator can delete administrators/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 3").get().count, 1, "target admin survives");
  // 普通管理员仍可删除普通成员
  assert.doesNotThrow(() => service.deleteUser({ id: 1, role: "admin" }, 2));
});

test("self deletion and unknown users are rejected", () => {
  const db = createTestDatabase();
  const service = createUserDeletionService({ db, superAdminLogin: "one" });

  assert.throws(() => service.deleteUser(OPERATOR, 1), /cannot delete your own account/);
  assert.throws(() => service.deleteUser(OPERATOR, 999), /user not found/);
  assert.throws(() => service.deleteUser(OPERATOR, "abc"), /invalid user id/);
  assert.throws(() => service.deleteUser(OPERATOR, 1), UserDeletionError);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2, "nothing was deleted");
});

test("super admin follows adminLogin instead of creation order", () => {
  const db = createTestDatabase();
  db.prepare("UPDATE users SET role = 'admin' WHERE id IN (1, 2)").run();

  const service = createUserDeletionService({ db, superAdminLogin: "two" });
  assert.equal(service.superAdminId(), 2);
  assert.equal(service.isSuperAdmin({ id: 2 }), true, "adminLogin account wins over the earlier-created admin");
  assert.equal(service.isSuperAdmin({ id: 1 }), false, "earlier creation no longer implies super admin");

  const unset = createUserDeletionService({ db, superAdminLogin: "" });
  assert.equal(unset.superAdminId(), null);
  assert.equal(unset.isSuperAdmin({ id: 1 }), false, "no adminLogin means no super admin");

  const missing = createUserDeletionService({ db, superAdminLogin: "nobody" });
  assert.equal(missing.superAdminId(), null, "unknown adminLogin yields no super admin");
});

test("user deletion wiring registers its activity type and survives logging failures", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ROOT = path.resolve(__dirname, "..");
  const activities = fs.readFileSync(path.join(ROOT, "src", "activities.js"), "utf8");
  assert.match(activities, /"user_deleted"/, "user_deleted must be an allowed activity type");
  const server = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  assert.match(server, /userDeletionService\.deleteUser/);
  assert.match(server, /type: "user_deleted"/);
  assert.match(server, /删除已经提交,活动记录失败不应让客户端误以为删除失败/);
  assert.match(server, /verifySecret\(body\.password, operatorRow\.password_hash\)/, "delete requires the operator password");

  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.match(app, /needsPassword/);
  assert.match(app, /method: "DELETE",\s*\n\s*body: JSON\.stringify\(\{ password \}\)/, "delete sends the operator password");
  assert.match(app, /user\.isSuperAdmin \? `<span class="role-pill super-admin"/, "super admin badge is rendered");
  assert.match(server, /isSuperAdmin: row\.id === superAdminId/, "user rows carry super admin flag");
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.match(html, /id="dialogPasswordInput" type="password"/);
});

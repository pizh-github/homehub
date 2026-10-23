"use strict";

const REGISTRATION_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRATION_INVITE_KINDS = new Set(["member", "admin"]);
const MAX_REGISTRATION_INVITE_NOTE_CHARS = 60;

class RegistrationInviteError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeRegistrationInviteCode(value) {
  return String(value || "").trim().replace(/[\s-]/g, "").toUpperCase();
}

function createRegistrationInviteService({
  db,
  hashValue,
  generateCode,
  inviteTtlMs = REGISTRATION_INVITE_TTL_MS
}) {
  function cleanupExpired(nowIso) {
    db.prepare("DELETE FROM registration_invites WHERE expires_at <= ? AND used_at IS NULL").run(nowIso);
  }

  function createInvite(creator, { kind = "member", note = "" } = {}) {
    if (!REGISTRATION_INVITE_KINDS.has(kind)) {
      throw new RegistrationInviteError("invite kind must be member or admin");
    }
    const trimmedNote = String(note || "").trim().slice(0, MAX_REGISTRATION_INVITE_NOTE_CHARS);
    const now = new Date();
    cleanupExpired(now.toISOString());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateCode();
      const codeHash = hashValue(code);
      const exists = db.prepare("SELECT id FROM registration_invites WHERE code_hash = ?").get(codeHash);
      if (exists) continue;
      const expiresAt = new Date(now.getTime() + inviteTtlMs).toISOString();
      const created = db.prepare(`
        INSERT INTO registration_invites (created_by_user_id, kind, code_hash, note, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(creator.id, kind, codeHash, trimmedNote, expiresAt, now.toISOString());
      return {
        id: Number(created.lastInsertRowid),
        kind,
        code,
        note: trimmedNote,
        expiresAt
      };
    }
    throw new RegistrationInviteError("could not generate invite code");
  }

  function decorate(row) {
    return {
      id: row.id,
      kind: row.kind,
      note: row.note || "",
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      used: Boolean(row.used_at),
      usedAt: row.used_at || null,
      usedBy: row.used_by_login || "",
      createdBy: row.creator_display_name || row.creator_login || ""
    };
  }

  function listInvites() {
    return db.prepare(`
      SELECT invite.*, creator.login AS creator_login, creator.display_name AS creator_display_name,
        invitee.login AS used_by_login
      FROM registration_invites invite
      JOIN users creator ON creator.id = invite.created_by_user_id
      LEFT JOIN users invitee ON invitee.id = invite.used_by_user_id
      ORDER BY invite.id DESC
    `).all().map(decorate);
  }

  function revokeInvite(id) {
    const deleted = db.prepare("DELETE FROM registration_invites WHERE id = ? AND used_at IS NULL").run(Number(id));
    if (!deleted.changes) throw new RegistrationInviteError("invite not found or already used", 404);
    return { ok: true, id: Number(id) };
  }

  function findUsable(value) {
    const code = normalizeRegistrationInviteCode(value);
    if (!code) return { error: "required" };
    const row = db.prepare("SELECT * FROM registration_invites WHERE code_hash = ?").get(hashValue(code));
    if (!row) return { error: "not_found" };
    if (row.used_at) return { error: "used" };
    if (row.expires_at <= new Date().toISOString()) return { error: "expired" };
    return { invite: row };
  }

  function markUsed(inviteId, userId, nowIso = new Date().toISOString()) {
    const updated = db.prepare(`
      UPDATE registration_invites SET used_at = ?, used_by_user_id = ?
      WHERE id = ? AND used_at IS NULL AND expires_at > ?
    `).run(nowIso, userId, inviteId, nowIso);
    if (!updated.changes) {
      throw new RegistrationInviteError("invite code is no longer available", 409);
    }
  }

  return { createInvite, listInvites, revokeInvite, findUsable, markUsed };
}

module.exports = {
  MAX_REGISTRATION_INVITE_NOTE_CHARS,
  REGISTRATION_INVITE_TTL_MS,
  RegistrationInviteError,
  createRegistrationInviteService,
  normalizeRegistrationInviteCode
};

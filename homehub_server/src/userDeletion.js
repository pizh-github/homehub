"use strict";

class UserDeletionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createUserDeletionService({ db, superAdminLogin }) {
  // 超级管理员 = 配置里 adminLogin 指定的那个管理员账号(与创建时间无关),唯一可以删除其他管理员
  function superAdminId() {
    const login = String(superAdminLogin || "").trim();
    if (!login) return null;
    const row = db.prepare("SELECT id FROM users WHERE login = ?").get(login);
    return row ? Number(row.id) : null;
  }

  function isSuperAdmin(user) {
    const id = superAdminId();
    return id !== null && Number(user?.id) === id;
  }

  function deleteUser(operator, targetId) {
    const id = Number(targetId);
    if (!Number.isInteger(id) || id <= 0) throw new UserDeletionError("invalid user id");
    if (id === Number(operator?.id)) throw new UserDeletionError("you cannot delete your own account");
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!target) throw new UserDeletionError("user not found", 404);

    const memberships = db
      .prepare("SELECT household_id FROM household_members WHERE user_id = ?")
      .all(id);
    const isTargetAdmin = target.role === "admin";
    if (isTargetAdmin && !isSuperAdmin(operator)) {
      throw new UserDeletionError("only the super administrator can delete administrators", 403);
    }

    let householdsRemoved = 0;
    let deletedUserIds = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      if (isTargetAdmin) {
        // 删除管理员:其家庭连同家庭内所有成员账号与内容全部删除
        for (const membership of memberships) {
          const memberIds = db
            .prepare("SELECT user_id FROM household_members WHERE household_id = ?")
            .all(membership.household_id)
            .map((row) => Number(row.user_id))
            .filter((memberId) => memberId !== Number(operator?.id));
          // 先删家庭:物品、动态、邀请随 CASCADE 清理,设备自动解绑
          db.prepare("DELETE FROM households WHERE id = ?").run(membership.household_id);
          householdsRemoved += 1;
          for (const memberId of memberIds) {
            db.prepare("DELETE FROM users WHERE id = ?").run(memberId);
            deletedUserIds.push(memberId);
          }
        }
        if (!deletedUserIds.includes(id)) {
          // 管理员不在任何家庭(异常数据)时至少删除账号本身
          db.prepare("DELETE FROM users WHERE id = ?").run(id);
          deletedUserIds.push(id);
        }
      } else {
        for (const membership of memberships) {
          const others = db
            .prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = ? AND user_id != ?")
            .get(membership.household_id, id).count;
          // 家庭只剩这一个成员时,连同家庭清理(物品随 CASCADE 删除,设备自动解绑)
          if (others === 0) {
            db.prepare("DELETE FROM households WHERE id = ?").run(membership.household_id);
            householdsRemoved += 1;
          }
        }
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
        deletedUserIds = [id];
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      id,
      login: target.login,
      displayName: target.display_name || target.login,
      role: target.role || "member",
      householdsRemoved,
      deletedUserCount: deletedUserIds.length
    };
  }

  return { deleteUser, isSuperAdmin, superAdminId };
}

module.exports = { UserDeletionError, createUserDeletionService };

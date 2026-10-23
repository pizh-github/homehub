"use strict";

const { addDays, daysBetween, localDateKey, parseDate } = require("./domain");

const PRIORITY_WEIGHTS = [0.5, 1, 1.5, 2];
const WEIGHT_MODES = new Set(["single", "total"]);
const EXERCISE_TYPES = new Set(["anaerobic", "aerobic"]);
const MAX_EXERCISE_NAME_CHARS = 40;
const MAX_AEROBIC_DURATION_MIN = 1440;
const MAX_AEROBIC_DISTANCE_KM = 500;
const MAX_AEROBIC_INCLINE = 30;
const MAX_DAILY_WEIGHT_TARGET = 50;
const MAX_REMIND_AFTER_DAYS = 365;
const MAX_HISTORY_DAYS = 400;

class FitnessError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizePriorityWeight(value) {
  const weight = Number(value);
  if (!PRIORITY_WEIGHTS.some((allowed) => Math.abs(allowed - weight) < 1e-9)) {
    throw new FitnessError("priorityWeight must be one of 0.5, 1, 1.5, 2");
  }
  return weight;
}

function normalizeNonNegativeNumber(value, field, max, digits) {
  const raw = value === undefined || value === "" || value === null ? 0 : Number(value);
  if (!Number.isFinite(raw) || raw < 0 || raw > max) {
    throw new FitnessError(`${field} must be a number from 0 to ${max}`);
  }
  return Math.round(raw * 10 ** digits) / 10 ** digits;
}

function normalizeOptionalInteger(value, field, max) {
  const raw = value === undefined || value === "" || value === null ? 0 : Number(value);
  if (!Number.isInteger(raw) || raw < 0 || raw > max) {
    throw new FitnessError(`${field} must be an integer from 0 to ${max}`);
  }
  return raw;
}

function normalizeNote(value) {
  const note = String(value ?? "").trim().slice(0, 100);
  return note;
}

function normalizeExerciseInput(input) {
  const name = String(input.name || "").trim();
  if (!name || name.length > MAX_EXERCISE_NAME_CHARS) {
    throw new FitnessError("name is required and must be at most 40 characters");
  }
  const type = input.type === undefined || input.type === "" ? "anaerobic" : String(input.type);
  if (!EXERCISE_TYPES.has(type)) {
    throw new FitnessError("type must be anaerobic or aerobic");
  }
  const sets = input.sets === undefined || input.sets === "" ? 3 : Number(input.sets);
  if (!Number.isInteger(sets) || sets < 1 || sets > 20) {
    throw new FitnessError("sets must be an integer from 1 to 20");
  }
  const reps = input.reps === undefined || input.reps === "" ? 12 : Number(input.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 500) {
    throw new FitnessError("reps must be an integer from 1 to 500");
  }
  const rawWeight = input.weightKg === undefined || input.weightKg === "" || input.weightKg === null ? 0 : Number(input.weightKg);
  if (!Number.isFinite(rawWeight) || rawWeight < 0 || rawWeight > 1000) {
    throw new FitnessError("weightKg must be a number from 0 to 1000");
  }
  const weightKg = Math.round(rawWeight * 10) / 10;
  const weightMode = input.weightMode === undefined || input.weightMode === "" ? "total" : String(input.weightMode);
  if (!WEIGHT_MODES.has(weightMode)) {
    throw new FitnessError("weightMode must be single or total");
  }
  const defaultDurationMin = normalizeNonNegativeNumber(input.defaultDurationMin, "defaultDurationMin", MAX_AEROBIC_DURATION_MIN, 1);
  const defaultDistanceKm = normalizeNonNegativeNumber(input.defaultDistanceKm, "defaultDistanceKm", MAX_AEROBIC_DISTANCE_KM, 2);
  const defaultIncline = normalizeNonNegativeNumber(input.defaultIncline, "defaultIncline", MAX_AEROBIC_INCLINE, 1);
  const priorityWeight = input.priorityWeight === undefined || input.priorityWeight === "" ? 1 : normalizePriorityWeight(input.priorityWeight);
  const rawSortOrder = input.sortOrder;
  const sortOrder =
    rawSortOrder === undefined || rawSortOrder === "" || rawSortOrder === null
      ? null
      : Number(rawSortOrder);
  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
    throw new FitnessError("sortOrder must be a non-negative integer");
  }
  return { name, type, sets, reps, weightKg, weightMode, defaultDurationMin, defaultDistanceKm, defaultIncline, priorityWeight, sortOrder };
}

function normalizeSettingsInput(input) {
  const rawTarget = Number(input.dailyWeightTarget);
  if (!Number.isFinite(rawTarget) || rawTarget * 2 !== Math.round(rawTarget * 2)) {
    throw new FitnessError("dailyWeightTarget must step by 0.5");
  }
  const dailyWeightTarget = Math.round(rawTarget * 2) / 2;
  if (dailyWeightTarget < 0.5 || dailyWeightTarget > MAX_DAILY_WEIGHT_TARGET) {
    throw new FitnessError(`dailyWeightTarget must be between 0.5 and ${MAX_DAILY_WEIGHT_TARGET}`);
  }
  const remindAfterDays = input.remindAfterDays === undefined || input.remindAfterDays === "" ? 3 : Number(input.remindAfterDays);
  if (!Number.isInteger(remindAfterDays) || remindAfterDays < 1 || remindAfterDays > MAX_REMIND_AFTER_DAYS) {
    throw new FitnessError(`remindAfterDays must be an integer from 1 to ${MAX_REMIND_AFTER_DAYS}`);
  }
  return { dailyWeightTarget, remindAfterDays };
}

function buildSubsetTables(items, capacity) {
  const count = items.length;
  const reachable = Array.from({ length: count + 1 }, () => new Uint8Array(capacity + 1));
  const weights = Array.from({ length: count + 1 }, () => new Float64Array(capacity + 1));
  reachable[count][0] = 1;
  weights[count][0] = 1;
  for (let i = count - 1; i >= 0; i -= 1) {
    const cost = items[i].cost;
    const weight = items[i].weight;
    for (let sum = 0; sum <= capacity; sum += 1) {
      const skipWeight = weights[i + 1][sum];
      const takeWeight = cost <= sum ? weight * weights[i + 1][sum - cost] : 0;
      weights[i][sum] = skipWeight + takeWeight;
      reachable[i][sum] =
        reachable[i + 1][sum] || (cost <= sum && reachable[i + 1][sum - cost]) ? 1 : 0;
    }
  }
  return { reachable, weights };
}

function sampleFromTable(tables, items, targetSum, random) {
  const { weights } = tables;
  const chosen = [];
  let sum = targetSum;
  for (let i = 0; i < items.length; i += 1) {
    const cost = items[i].cost;
    const skipWeight = weights[i + 1][sum];
    const takeWeight = cost <= sum ? items[i].weight * weights[i + 1][sum - cost] : 0;
    const total = skipWeight + takeWeight;
    if (total <= 0) continue;
    if (random() * total < takeWeight) {
      chosen.push(items[i].exercise);
      sum -= cost;
    }
  }
  return chosen;
}

function sampleExactSubset(items, capacity, random) {
  if (!items.length || capacity < 1) return null;
  const tables = buildSubsetTables(items, capacity);
  if (!tables.reachable[0][capacity]) return null;
  return sampleFromTable(tables, items, capacity, random);
}

function sampleBestUnderSubset(items, capacity, random) {
  if (!items.length) return null;
  const tables = buildSubsetTables(items, capacity);
  let best = -1;
  for (let sum = capacity - 1; sum >= 1; sum -= 1) {
    if (tables.reachable[0][sum]) {
      best = sum;
      break;
    }
  }
  if (best < 1) return null;
  return sampleFromTable(tables, items, best, random);
}

function selectDayExercises(exercises, targetWeight, { random = Math.random, todayKey } = {}) {
  const capacity = Math.round(Number(targetWeight) * 2);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new FitnessError("daily weight target is too small");
  }
  const items = exercises.map((exercise) => ({
    exercise,
    cost: Math.max(1, Math.round(exercise.priority_weight * 2)),
    weight: 1 / (Number(exercise.selection_count) + 1)
  }));
  if (!items.length) {
    throw new FitnessError("no exercises available; add exercises first");
  }
  const yesterdayKey = todayKey ? addDays(todayKey, -1) : null;
  const isRecent = (item) => {
    const last = item.exercise.last_selected_date;
    return Boolean(last) && (last === todayKey || (yesterdayKey && last === yesterdayKey));
  };
  const preferred = items.filter((item) => !isRecent(item));
  const candidates = preferred.length ? preferred : items;

  const exact = sampleExactSubset(candidates, capacity, random) ||
    (candidates === items ? null : sampleExactSubset(items, capacity, random));
  if (exact) return { exercises: exact, targetMet: true, targetShort: false };
  const under = sampleBestUnderSubset(candidates, capacity, random);
  if (under) return { exercises: under, targetMet: false, targetShort: false };
  const minCost = Math.min(...items.map((item) => item.cost));
  const smallest = items
    .filter((item) => item.cost === minCost)
    .sort((a, b) => a.exercise.selection_count - b.exercise.selection_count);
  return { exercises: [smallest[0].exercise], targetMet: false, targetShort: true };
}

function createFitnessService({
  db,
  timezone = "Asia/Shanghai",
  random = Math.random,
  today = () => localDateKey(timezone)
}) {
  function publicExercise(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type || "anaerobic",
      sets: row.sets,
      reps: row.reps,
      weightKg: row.weight_kg,
      weightMode: row.weight_mode,
      defaultDurationMin: row.default_duration_min,
      defaultDistanceKm: row.default_distance_km,
      defaultIncline: row.default_incline,
      priorityWeight: row.priority_weight,
      selectionCount: row.selection_count,
      lastSelectedDate: row.last_selected_date,
      archived: Boolean(row.archived),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function publicSettings(row) {
    return {
      dailyWeightTarget: row.daily_weight_target,
      remindAfterDays: row.remind_after_days
    };
  }

  function ensureSettings(userId) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO fitness_settings (user_id, daily_weight_target, remind_after_days, created_at, updated_at) VALUES (?, 5, 3, ?, ?)"
    ).run(userId, now, now);
    return db.prepare("SELECT * FROM fitness_settings WHERE user_id = ?").get(userId);
  }

  function getSettings(userId) {
    return publicSettings(ensureSettings(userId));
  }

  function updateSettings(userId, input) {
    const settings = normalizeSettingsInput(input || {});
    const now = new Date().toISOString();
    ensureSettings(userId);
    db.prepare(
      "UPDATE fitness_settings SET daily_weight_target = ?, remind_after_days = ?, updated_at = ? WHERE user_id = ?"
    ).run(settings.dailyWeightTarget, settings.remindAfterDays, now, userId);
    return getSettings(userId);
  }

  function listExercises(userId) {
    const rows = db
      .prepare(
        "SELECT * FROM fitness_exercises WHERE user_id = ? AND archived = 0 ORDER BY sort_order, id"
      )
      .all(userId);
    return rows.map(publicExercise);
  }

  function getExerciseRow(userId, id) {
    const row = db
      .prepare("SELECT * FROM fitness_exercises WHERE id = ? AND user_id = ? AND archived = 0")
      .get(Number(id), userId);
    if (!row) throw new FitnessError("exercise not found", 404);
    return row;
  }

  function createExercise(userId, input) {
    const exercise = normalizeExerciseInput(input || {});
    const now = new Date().toISOString();
    const nextSort = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM fitness_exercises WHERE user_id = ?")
      .get(userId).next;
    const created = db.prepare(
      "INSERT INTO fitness_exercises (user_id, name, type, sets, reps, weight_kg, weight_mode, default_duration_min, default_distance_km, default_incline, priority_weight, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      userId,
      exercise.name,
      exercise.type,
      exercise.sets,
      exercise.reps,
      exercise.weightKg,
      exercise.weightMode,
      exercise.defaultDurationMin,
      exercise.defaultDistanceKm,
      exercise.defaultIncline,
      exercise.priorityWeight,
      exercise.sortOrder ?? nextSort,
      now,
      now
    );
    return publicExercise(getExerciseRow(userId, Number(created.lastInsertRowid)));
  }

  function updateExercise(userId, id, patch) {
    const row = getExerciseRow(userId, id);
    const merged = normalizeExerciseInput({
      name: patch.name ?? row.name,
      type: patch.type ?? row.type,
      sets: patch.sets ?? row.sets,
      reps: patch.reps ?? row.reps,
      weightKg: patch.weightKg ?? row.weight_kg,
      weightMode: patch.weightMode ?? row.weight_mode,
      defaultDurationMin: patch.defaultDurationMin ?? row.default_duration_min,
      defaultDistanceKm: patch.defaultDistanceKm ?? row.default_distance_km,
      defaultIncline: patch.defaultIncline ?? row.default_incline,
      priorityWeight: patch.priorityWeight ?? row.priority_weight,
      sortOrder: patch.sortOrder ?? row.sort_order
    });
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE fitness_exercises SET name = ?, type = ?, sets = ?, reps = ?, weight_kg = ?, weight_mode = ?, default_duration_min = ?, default_distance_km = ?, default_incline = ?, priority_weight = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(
      merged.name,
      merged.type,
      merged.sets,
      merged.reps,
      merged.weightKg,
      merged.weightMode,
      merged.defaultDurationMin,
      merged.defaultDistanceKm,
      merged.defaultIncline,
      merged.priorityWeight,
      merged.sortOrder,
      now,
      row.id,
      userId
    );
    return publicExercise(getExerciseRow(userId, row.id));
  }

  function deleteExercise(userId, id) {
    const row = db
      .prepare("SELECT * FROM fitness_exercises WHERE id = ? AND user_id = ?")
      .get(Number(id), userId);
    if (!row) throw new FitnessError("exercise not found", 404);
    // 历史天记录保存的是完整快照,set / aerobic 结果也不外键引用项目行,硬删除不影响历史展示
    db.prepare("DELETE FROM fitness_exercises WHERE id = ? AND user_id = ?").run(row.id, userId);
    return publicExercise(row);
  }

  function getDayRow(userId, date) {
    return db
      .prepare("SELECT * FROM fitness_workout_days WHERE user_id = ? AND workout_date = ?")
      .get(userId, date);
  }

  function toSnapshot(exercise) {
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      type: exercise.type || "anaerobic",
      sets: exercise.sets,
      reps: exercise.reps,
      weightKg: exercise.weight_kg,
      weightMode: exercise.weight_mode,
      defaultDurationMin: exercise.default_duration_min,
      defaultDistanceKm: exercise.default_distance_km,
      defaultIncline: exercise.default_incline,
      priorityWeight: exercise.priority_weight
    };
  }

  function readSnapshot(row) {
    try {
      const snapshot = JSON.parse(row.selected_exercises_json || "[]");
      return Array.isArray(snapshot) ? snapshot : [];
    } catch {
      return [];
    }
  }

  function setResultsForDay(dayId) {
    return db
      .prepare("SELECT * FROM fitness_set_results WHERE workout_day_id = ? ORDER BY exercise_id, set_index")
      .all(dayId);
  }

  function aerobicResultsForDay(dayId) {
    return db
      .prepare("SELECT * FROM fitness_aerobic_results WHERE workout_day_id = ?")
      .all(dayId);
  }

  function decorateDay(row) {
    if (!row) {
      return {
        date: null,
        status: "none",
        exercises: [],
        completedSets: 0,
        totalSets: 0,
        startedAt: null,
        completedAt: null
      };
    }
    const results = setResultsForDay(row.id);
    const byExercise = new Map();
    for (const result of results) {
      const list = byExercise.get(result.exercise_id) || [];
      list.push(result);
      byExercise.set(result.exercise_id, list);
    }
    const aerobic = new Map();
    for (const result of aerobicResultsForDay(row.id)) {
      aerobic.set(result.exercise_id, {
        completed: Boolean(result.completed),
        durationMin: result.duration_min,
        distanceKm: result.distance_km,
        incline: result.incline,
        avgHeartRate: result.avg_heart_rate || 0,
        note: result.note || "",
        completedAt: result.completed_at
      });
    }
    const exercises = readSnapshot(row).map((item) => ({
      ...item,
      type: item.type || "anaerobic",
      results: (byExercise.get(item.exerciseId) || []).map((result) => ({
        setIndex: result.set_index,
        completed: Boolean(result.completed),
        completedAt: result.completed_at
      })),
      aerobic: aerobic.get(item.exerciseId) || null
    }));
    const completedSets = exercises.reduce((sum, exercise) => {
      if (exercise.type === "aerobic") return sum + (exercise.aerobic?.completed ? 1 : 0);
      return sum + exercise.results.filter((result) => result.completed).length;
    }, 0);
    const totalSets = exercises.reduce((sum, exercise) => {
      if (exercise.type === "aerobic") return sum + 1;
      return sum + (Number(exercise.sets) || 0);
    }, 0);
    return {
      date: row.workout_date,
      status: row.status,
      exercises,
      completedSets,
      totalSets,
      startedAt: row.started_at,
      completedAt: row.completed_at
    };
  }

  function getDay(userId, date) {
    const key = parseDate(date, "date");
    const day = decorateDay(getDayRow(userId, key));
    return { ...day, date: key };
  }

  function assertToday(date) {
    if (parseDate(date, "date") !== today()) {
      throw new FitnessError("workout actions are only allowed for today");
    }
  }

  function pickAndApplyDay(userId, date, dayId, existingSnapshot) {
    const settings = getSettings(userId);
    const exercises = db
      .prepare("SELECT * FROM fitness_exercises WHERE user_id = ? AND archived = 0 ORDER BY sort_order, id")
      .all(userId);
    if (!exercises.length) {
      throw new FitnessError("no exercises available; add exercises first");
    }
    const now = new Date().toISOString();
    const todayKey = today();
    const picked = selectDayExercises(exercises, settings.dailyWeightTarget, { random, todayKey });
    const snapshot = picked.exercises.map(toSnapshot);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (existingSnapshot.length) {
        const rollback = db.prepare(
          "UPDATE fitness_exercises SET selection_count = MAX(selection_count - 1, 0), updated_at = ? WHERE id = ?"
        );
        for (const item of existingSnapshot) rollback.run(now, item.exerciseId);
      }
      if (dayId) {
        db.prepare("DELETE FROM fitness_set_results WHERE workout_day_id = ?").run(dayId);
        db.prepare("DELETE FROM fitness_aerobic_results WHERE workout_day_id = ?").run(dayId);
        db.prepare(
          "UPDATE fitness_workout_days SET status = 'active', selected_exercises_json = ?, started_at = ?, completed_at = NULL WHERE id = ?"
        ).run(JSON.stringify(snapshot), now, dayId);
      } else {
        const created = db.prepare(
          "INSERT INTO fitness_workout_days (user_id, workout_date, status, selected_exercises_json, started_at) VALUES (?, ?, 'active', ?, ?)"
        ).run(userId, date, JSON.stringify(snapshot), now);
        dayId = Number(created.lastInsertRowid);
      }
      const bump = db.prepare(
        "UPDATE fitness_exercises SET selection_count = selection_count + 1, last_selected_date = ?, updated_at = ? WHERE id = ?"
      );
      const insertSet = db.prepare(
        "INSERT INTO fitness_set_results (workout_day_id, exercise_id, set_index, completed) VALUES (?, ?, ?, 0)"
      );
      const insertAerobic = db.prepare(
        "INSERT INTO fitness_aerobic_results (workout_day_id, exercise_id, completed, duration_min, distance_km, incline) VALUES (?, ?, 0, ?, ?, ?)"
      );
      for (const item of snapshot) {
        bump.run(todayKey, now, item.exerciseId);
        if (item.type === "aerobic") {
          insertAerobic.run(
            dayId,
            item.exerciseId,
            Number(item.defaultDurationMin) || 0,
            Number(item.defaultDistanceKm) || 0,
            Number(item.defaultIncline) || 0
          );
          continue;
        }
        for (let index = 0; index < item.sets; index += 1) insertSet.run(dayId, item.exerciseId, index);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { day: getDay(userId, date), targetShort: picked.targetShort };
  }

  function startDay(userId, date) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (existing?.status === "completed") {
      throw new FitnessError("workout already completed; reopen it first", 409);
    }
    if (existing?.status === "active") {
      return { ...getDay(userId, date), targetShort: false };
    }
    const result = pickAndApplyDay(userId, date, existing?.id || null, existing ? readSnapshot(existing) : []);
    return { ...result.day, targetShort: result.targetShort };
  }

  function regenerateDay(userId, date) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (!existing || existing.status !== "active") {
      throw new FitnessError("workout is not active; start it first", 409);
    }
    const result = pickAndApplyDay(userId, date, existing.id, readSnapshot(existing));
    return { ...result.day, targetShort: result.targetShort };
  }

  function toggleSet(userId, date, exerciseId, setIndex) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (!existing || existing.status !== "active") {
      throw new FitnessError("workout is not active; start it first", 409);
    }
    const snapshot = readSnapshot(existing);
    const item = snapshot.find((entry) => Number(entry.exerciseId) === Number(exerciseId));
    if (!item) throw new FitnessError("exercise is not part of this workout", 404);
    if (item.type === "aerobic") {
      throw new FitnessError("aerobic exercises use the aerobic confirm endpoint");
    }
    if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= item.sets) {
      throw new FitnessError("setIndex is out of range");
    }
    const result = db
      .prepare(
        "SELECT * FROM fitness_set_results WHERE workout_day_id = ? AND exercise_id = ? AND set_index = ?"
      )
      .get(existing.id, Number(exerciseId), setIndex);
    if (!result) throw new FitnessError("set result not found", 404);
    const completed = result.completed ? 0 : 1;
    const nowIso = new Date().toISOString();
    db.prepare(
      "UPDATE fitness_set_results SET completed = ?, completed_at = ? WHERE id = ?"
    ).run(completed, completed ? nowIso : null, result.id);
    return { exerciseId: Number(exerciseId), setIndex, completed: Boolean(completed), completedAt: completed ? nowIso : null };
  }

  function setAerobicResult(userId, date, exerciseId, input) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (!existing || existing.status !== "active") {
      throw new FitnessError("workout is not active; start it first", 409);
    }
    const item = readSnapshot(existing).find((entry) => Number(entry.exerciseId) === Number(exerciseId));
    if (!item) throw new FitnessError("exercise is not part of this workout", 404);
    if (item.type !== "aerobic") {
      throw new FitnessError("exercise is not an aerobic exercise");
    }
    const row = db
      .prepare("SELECT * FROM fitness_aerobic_results WHERE workout_day_id = ? AND exercise_id = ?")
      .get(existing.id, Number(exerciseId));
    if (!row) throw new FitnessError("aerobic result not found", 404);
    const completed = input?.completed === undefined ? Boolean(row.completed) : input.completed === true;
    const durationMin = normalizeNonNegativeNumber(
      input?.durationMin ?? row.duration_min,
      "durationMin",
      MAX_AEROBIC_DURATION_MIN,
      1
    );
    const distanceKm = normalizeNonNegativeNumber(
      input?.distanceKm ?? row.distance_km,
      "distanceKm",
      MAX_AEROBIC_DISTANCE_KM,
      2
    );
    const incline = normalizeNonNegativeNumber(input?.incline ?? row.incline, "incline", MAX_AEROBIC_INCLINE, 1);
    const avgHeartRate = normalizeOptionalInteger(input?.avgHeartRate ?? row.avg_heart_rate, "avgHeartRate", 250);
    const note = normalizeNote(input?.note ?? row.note);
    const nowIso = new Date().toISOString();
    db.prepare(
      "UPDATE fitness_aerobic_results SET completed = ?, duration_min = ?, distance_km = ?, incline = ?, avg_heart_rate = ?, note = ?, completed_at = ? WHERE id = ?"
    ).run(completed ? 1 : 0, durationMin, distanceKm, incline, avgHeartRate, note, completed ? nowIso : null, row.id);
    return {
      exerciseId: Number(exerciseId),
      completed,
      durationMin,
      distanceKm,
      incline,
      avgHeartRate,
      note,
      completedAt: completed ? nowIso : null
    };
  }

  function finishDay(userId, date) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (!existing || existing.status !== "active") {
      throw new FitnessError("workout is not active; start it first", 409);
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      "UPDATE fitness_workout_days SET status = 'completed', completed_at = ? WHERE id = ?"
    ).run(nowIso, existing.id);
    return getDay(userId, date);
  }

  function reopenDay(userId, date) {
    assertToday(date);
    const existing = getDayRow(userId, date);
    if (!existing || existing.status !== "completed") {
      throw new FitnessError("workout is not completed", 409);
    }
    db.prepare(
      "UPDATE fitness_workout_days SET status = 'active', completed_at = NULL WHERE id = ?"
    ).run(existing.id);
    return getDay(userId, date);
  }

  function planDay(userId, date) {
    const key = parseDate(date, "date");
    if (key <= today()) {
      throw new FitnessError("only future dates can be planned");
    }
    const existing = getDayRow(userId, key);
    if (existing?.status === "active" || existing?.status === "completed") {
      throw new FitnessError(`workout on ${key} is already ${existing.status}`, 409);
    }
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO fitness_workout_days (user_id, workout_date, status) VALUES (?, ?, 'planned')"
      ).run(userId, key);
    }
    return { date: key, status: "planned" };
  }

  function unplanDay(userId, date) {
    const key = parseDate(date, "date");
    if (key <= today()) {
      throw new FitnessError("only future plans can be cancelled");
    }
    const existing = getDayRow(userId, key);
    if (existing?.status === "active" || existing?.status === "completed") {
      throw new FitnessError(`workout on ${key} is already ${existing.status}`, 409);
    }
    if (existing) {
      db.prepare("DELETE FROM fitness_workout_days WHERE id = ?").run(existing.id);
    }
    return { date: key, status: "none" };
  }

  function getCalendar(userId, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) {
      throw new FitnessError("month must use YYYY-MM");
    }
    const rows = db
      .prepare(
        "SELECT workout_date, status FROM fitness_workout_days WHERE user_id = ? AND workout_date LIKE ?"
      )
      .all(userId, `${month}-%`);
    const days = {};
    for (const row of rows) days[row.workout_date] = row.status;
    return { month, today: today(), days };
  }

  function getHistory(userId, from, to) {
    const fromKey = parseDate(from || "", "from");
    const toKey = parseDate(to || "", "to");
    if (fromKey > toKey) throw new FitnessError("from must not be after to");
    if (daysBetween(fromKey, toKey) + 1 > MAX_HISTORY_DAYS) {
      throw new FitnessError(`history range must be at most ${MAX_HISTORY_DAYS} days`);
    }
    const rows = db
      .prepare(
        "SELECT * FROM fitness_workout_days WHERE user_id = ? AND workout_date >= ? AND workout_date <= ? ORDER BY workout_date DESC"
      )
      .all(userId, fromKey, toKey);
    return rows.map((row) => {
      const day = decorateDay(row);
      return {
        date: day.date,
        status: day.status,
        exerciseCount: day.exercises.length,
        completedSets: day.completedSets,
        totalSets: day.totalSets,
        startedAt: day.startedAt,
        completedAt: day.completedAt
      };
    });
  }

  function getOverview(userId) {
    const todayKey = today();
    const settings = ensureSettings(userId);
    const day = decorateDay(getDayRow(userId, todayKey));
    const lastCompleted = db
      .prepare(
        "SELECT MAX(workout_date) AS workout_date FROM fitness_workout_days WHERE user_id = ? AND status = 'completed'"
      )
      .get(userId).workout_date;
    const daysSinceLastCompleted = lastCompleted ? daysBetween(lastCompleted, todayKey) : null;
    const counts = db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) AS active FROM fitness_exercises WHERE user_id = ?"
      )
      .get(userId);
    const shouldRemind =
      daysSinceLastCompleted !== null &&
      daysSinceLastCompleted >= settings.remind_after_days &&
      day.status !== "active" &&
      day.status !== "completed";
    return {
      today: { ...day, date: todayKey },
      daysSinceLastCompleted,
      remindAfterDays: settings.remind_after_days,
      dailyWeightTarget: settings.daily_weight_target,
      shouldRemind,
      totalExercises: Number(counts.total) || 0,
      activeExercises: Number(counts.active) || 0
    };
  }

  return {
    createExercise,
    deleteExercise,
    finishDay,
    getCalendar,
    getDay,
    getHistory,
    getOverview,
    getSettings,
    listExercises,
    planDay,
    regenerateDay,
    reopenDay,
    setAerobicResult,
    startDay,
    toggleSet,
    unplanDay,
    updateExercise,
    updateSettings
  };
}

module.exports = {
  FitnessError,
  createFitnessService,
  normalizeExerciseInput,
  normalizeSettingsInput,
  selectDayExercises
};

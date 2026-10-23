"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const { createTestDatabase } = require("./helpers");
const { migrateFitnessTables } = require("../src/migrations");
const { FitnessError, createFitnessService, selectDayExercises } = require("../src/fitness");

const ROOT = path.resolve(__dirname, "..");
const TODAY = "2026-07-20";

function makeExerciseRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    name: overrides.name || "卧推",
    priority_weight: overrides.priority_weight ?? 1,
    selection_count: overrides.selection_count ?? 0,
    last_selected_date: overrides.last_selected_date ?? null
  };
}

function createService(db, overrides = {}) {
  return createFitnessService({
    db,
    today: overrides.today || (() => TODAY),
    random: overrides.random || Math.random
  });
}

test("exercise validation rejects unsupported priority weights and modes", () => {
  const db = createTestDatabase();
  const service = createService(db);
  assert.throws(() => service.createExercise(1, { name: "卧推", priorityWeight: 3 }), /priorityWeight/);
  assert.throws(() => service.createExercise(1, { name: "卧推", weightMode: "both" }), /weightMode/);
  assert.throws(() => service.createExercise(1, { name: "" }), /name/);
  assert.throws(() => service.createExercise(1, { name: "卧推", sets: 0 }), /sets/);
  assert.throws(() => service.createExercise(1, { name: "卧推", reps: "abc" }), /reps/);
  assert.throws(() => service.createExercise(1, { name: "卧推", weightKg: -1 }), /weightKg/);
});

test("exercise CRUD keeps defaults, ordering and soft delete", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const first = service.createExercise(1, { name: "卧推" });
  assert.equal(first.sets, 3);
  assert.equal(first.reps, 12);
  assert.equal(first.weightKg, 0);
  assert.equal(first.weightMode, "total");
  assert.equal(first.priorityWeight, 1);
  assert.equal(first.sortOrder, 0);

  const second = service.createExercise(1, {
    name: "哑铃弯举",
    sets: 4,
    reps: 10,
    weightKg: "10.25",
    weightMode: "single",
    priorityWeight: 2
  });
  assert.equal(second.weightKg, 10.3);
  assert.equal(second.weightMode, "single");
  assert.equal(second.sortOrder, 1);

  const updated = service.updateExercise(1, first.id, { weightKg: 20, priorityWeight: 1.5 });
  assert.equal(updated.weightKg, 20);
  assert.equal(updated.priorityWeight, 1.5);
  assert.equal(updated.name, "卧推");

  const deleted = service.deleteExercise(1, first.id);
  assert.equal(deleted.id, first.id);
  assert.deepEqual(service.listExercises(1).map((row) => row.id), [second.id]);
  assert.throws(() => service.updateExercise(1, first.id, { name: "复活" }), FitnessError);
  assert.throws(() => service.deleteExercise(1, first.id), FitnessError, "second delete is a 404");
});

test("settings default, validation and update", () => {
  const db = createTestDatabase();
  const service = createService(db);
  assert.deepEqual(service.getSettings(1), { dailyWeightTarget: 5, remindAfterDays: 3 });
  assert.throws(() => service.updateSettings(1, { dailyWeightTarget: 0.3, remindAfterDays: 3 }), /step/);
  assert.throws(() => service.updateSettings(1, { dailyWeightTarget: 51, remindAfterDays: 3 }), /between/);
  assert.throws(() => service.updateSettings(1, { dailyWeightTarget: 5, remindAfterDays: 0 }), /remindAfterDays/);
  assert.deepEqual(service.updateSettings(1, { dailyWeightTarget: 7.5, remindAfterDays: 2 }), {
    dailyWeightTarget: 7.5,
    remindAfterDays: 2
  });
});

test("selectDayExercises finds exact subset then weighted-fair picks", () => {
  const exercises = [
    makeExerciseRow({ id: 1, priority_weight: 1 }),
    makeExerciseRow({ id: 2, priority_weight: 2 })
  ];
  const picked = selectDayExercises(exercises, 3, { random: () => 0, todayKey: TODAY });
  assert.deepEqual(picked.exercises.map((row) => row.id).sort(), [1, 2]);
  assert.equal(picked.targetMet, true);

  const alwaysTakeFirst = selectDayExercises(
    [makeExerciseRow({ id: 1, priority_weight: 0.5 }), makeExerciseRow({ id: 2, priority_weight: 0.5 })],
    0.5,
    { random: () => 0.9, todayKey: TODAY }
  );
  assert.deepEqual(alwaysTakeFirst.exercises.map((row) => row.id), [2]);
  const weightTakesFirst = selectDayExercises(
    [makeExerciseRow({ id: 1, priority_weight: 0.5 }), makeExerciseRow({ id: 2, priority_weight: 0.5 })],
    0.5,
    { random: () => 0.1, todayKey: TODAY }
  );
  assert.deepEqual(weightTakesFirst.exercises.map((row) => row.id), [1]);

  const bestUnder = selectDayExercises([makeExerciseRow({ priority_weight: 1 })], 3, {
    random: () => 0,
    todayKey: TODAY
  });
  assert.deepEqual(bestUnder.exercises.map((row) => row.id), [1]);
  assert.equal(bestUnder.targetMet, false);
  assert.equal(bestUnder.targetShort, false);

  const tooHeavy = selectDayExercises([makeExerciseRow({ priority_weight: 2 })], 0.5, {
    random: () => 0,
    todayKey: TODAY
  });
  assert.equal(tooHeavy.targetShort, true);
  assert.equal(tooHeavy.exercises.length, 1);

  assert.throws(() => selectDayExercises([], 5, { random: () => 0, todayKey: TODAY }), /no exercises/);
});

test("selectDayExercises avoids yesterday and today selections with fallback", () => {
  const exercises = [
    makeExerciseRow({ id: 1, priority_weight: 1, last_selected_date: "2026-07-19" }),
    makeExerciseRow({ id: 2, priority_weight: 1 })
  ];
  const avoidRecent = selectDayExercises(exercises, 1, { random: () => 0, todayKey: TODAY });
  assert.deepEqual(avoidRecent.exercises.map((row) => row.id), [2]);

  const fallbackToAll = selectDayExercises(
    [makeExerciseRow({ id: 1, priority_weight: 1, last_selected_date: "2026-07-19" })],
    1,
    { random: () => 0, todayKey: TODAY }
  );
  assert.deepEqual(fallbackToAll.exercises.map((row) => row.id), [1]);
});

test("fair weighting prefers low selection counts over many draws", () => {
  const exercises = [
    makeExerciseRow({ id: 1, selection_count: 9 }),
    makeExerciseRow({ id: 2, selection_count: 0 })
  ];
  const counts = new Map([[1, 0], [2, 0]]);
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const picked = selectDayExercises(exercises, 1, { random: Math.random, todayKey: TODAY });
    counts.set(picked.exercises[0].id, counts.get(picked.exercises[0].id) + 1);
  }
  assert.ok(counts.get(2) > 350, `expected fair bias, counts=${JSON.stringify([...counts])}`);
  assert.ok(counts.get(2) > counts.get(1) * 3, `expected strong bias, counts=${JSON.stringify([...counts])}`);
});

test("start day generates snapshot, set results and fairness counters", () => {
  const db = createTestDatabase();
  const service = createService(db);
  service.createExercise(1, { name: "卧推", sets: 3, priorityWeight: 1 });
  service.createExercise(1, { name: "硬拉", sets: 2, priorityWeight: 2 });

  const day = service.startDay(1, TODAY);
  assert.equal(day.status, "active");
  assert.equal(day.targetShort, false);
  assert.equal(day.totalSets, 5);
  assert.equal(day.exercises.length, 2);
  assert.ok(day.exercises.every((item) => item.results.length > 0));
  assert.ok(day.exercises.every((item) => item.results.every((result) => !result.completed)));

  const exercises = service.listExercises(1);
  assert.ok(exercises.every((row) => row.selectionCount === 1));
  assert.ok(exercises.every((row) => row.lastSelectedDate === TODAY));

  assert.throws(() => service.startDay(1, "2026-07-19"), /only allowed for today/);
  assert.throws(() => service.startDay(1, "2026-07-21"), /only allowed for today/);
});

test("toggle set, finish and reopen keep completed results", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const exercise = service.createExercise(1, { name: "卧推", sets: 3, priorityWeight: 2 });
  service.startDay(1, TODAY);

  const toggled = service.toggleSet(1, TODAY, exercise.id, 0);
  assert.equal(toggled.completed, true);
  assert.ok(toggled.completedAt);

  assert.deepEqual(service.toggleSet(1, TODAY, exercise.id, 0), {
    exerciseId: exercise.id,
    setIndex: 0,
    completed: false,
    completedAt: null
  });
  assert.equal(service.toggleSet(1, TODAY, exercise.id, 2).completed, true);
  assert.throws(() => service.toggleSet(1, TODAY, exercise.id, 3), /out of range/);
  assert.throws(() => service.toggleSet(1, TODAY, 9999, 0), /not part of this workout/);

  const finished = service.finishDay(1, TODAY);
  assert.equal(finished.status, "completed");
  assert.ok(finished.completedAt);
  assert.equal(finished.completedSets, 1);
  assert.throws(() => service.finishDay(1, TODAY), /not active/);
  assert.throws(() => service.startDay(1, TODAY), /already completed/);

  const reopened = service.reopenDay(1, TODAY);
  assert.equal(reopened.status, "active");
  assert.equal(reopened.completedSets, 1);
  assert.throws(() => service.reopenDay(1, TODAY), /not completed/);
});

test("regenerate clears results, rolls back counters and re-picks", () => {
  const db = createTestDatabase();
  const service = createService(db, { random: () => 0 });
  const exercise = service.createExercise(1, { name: "卧推", sets: 2, priorityWeight: 1 });
  service.startDay(1, TODAY);
  service.toggleSet(1, TODAY, exercise.id, 0);

  const regenerated = service.regenerateDay(1, TODAY);
  assert.equal(regenerated.status, "active");
  assert.equal(regenerated.completedSets, 0);
  const row = service.listExercises(1)[0];
  assert.equal(row.selectionCount, 1);
  const setResults = db
    .prepare("SELECT COUNT(*) AS count FROM fitness_set_results")
    .get();
  assert.equal(setResults.count, regenerated.totalSets);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM fitness_set_results WHERE completed = 1").get().count, 0);

  assert.throws(() => service.regenerateDay(1, "2026-07-21"), /only allowed for today/);
  const other = createService(db);
  other.startDay(1, TODAY);
  other.finishDay(1, TODAY);
  assert.throws(() => other.regenerateDay(1, TODAY), /not active/);
});

test("plan and unplan only accept future dates without active workouts", () => {
  const db = createTestDatabase();
  const service = createService(db);
  service.createExercise(1, { name: "卧推", sets: 2, priorityWeight: 1 });
  service.planDay(1, "2026-07-25");
  assert.deepEqual(service.planDay(1, "2026-07-25"), { date: "2026-07-25", status: "planned" });
  assert.throws(() => service.planDay(1, TODAY), /future/);
  assert.throws(() => service.planDay(1, "2026-07-19"), /future/);

  assert.deepEqual(service.unplanDay(1, "2026-07-25"), { date: "2026-07-25", status: "none" });
  assert.deepEqual(service.unplanDay(1, "2026-07-25"), { date: "2026-07-25", status: "none" });
  assert.throws(() => service.unplanDay(1, TODAY), /future/);
});

test("calendar exposes month statuses and today marker", () => {
  const db = createTestDatabase();
  const service = createService(db);
  service.createExercise(1, { name: "卧推", sets: 2, priorityWeight: 2 });
  service.planDay(1, "2026-07-25");
  service.startDay(1, TODAY);
  service.finishDay(1, TODAY);

  const calendar = service.getCalendar(1, "2026-07");
  assert.equal(calendar.month, "2026-07");
  assert.equal(calendar.today, TODAY);
  assert.equal(calendar.days[TODAY], "completed");
  assert.equal(calendar.days["2026-07-25"], "planned");
  assert.throws(() => service.getCalendar(1, "2026-13"), /YYYY-MM/);
});

test("history filters by range and summarizes days", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const exercise = service.createExercise(1, { name: "卧推", sets: 2, priorityWeight: 2 });
  service.startDay(1, TODAY);
  service.toggleSet(1, TODAY, exercise.id, 0);
  service.finishDay(1, TODAY);

  const items = service.getHistory(1, "2026-07-01", "2026-07-31");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    date: TODAY,
    status: "completed",
    exerciseCount: 1,
    completedSets: 1,
    totalSets: 2,
    startedAt: items[0].startedAt,
    completedAt: items[0].completedAt
  });
  assert.ok(items[0].completedAt);
  assert.deepEqual(service.getHistory(1, "2026-08-01", "2026-08-31"), []);
  assert.throws(() => service.getHistory(1, "2026-07-31", "2026-07-01"), /from must not be after to/);
  assert.throws(() => service.getHistory(1, "2020-01-01", "2026-07-31"), /at most 400 days/);
});

test("overview reminds only after workouts exist and threshold reached", () => {
  const db = createTestDatabase();
  const first = createService(db);
  const exercise = first.createExercise(1, { name: "卧推", sets: 2, priorityWeight: 2 });

  const fresh = first.getOverview(1);
  assert.equal(fresh.daysSinceLastCompleted, null);
  assert.equal(fresh.shouldRemind, false);
  assert.equal(fresh.today.status, "none");
  assert.equal(fresh.activeExercises, 1);

  first.startDay(1, TODAY);
  assert.equal(first.getOverview(1).shouldRemind, false, "active day suppresses reminder");
  first.finishDay(1, TODAY);
  assert.equal(first.getOverview(1).shouldRemind, false, "completed today suppresses reminder");

  const later = createService(db, { today: () => "2026-07-23" });
  const overview = later.getOverview(1);
  assert.equal(overview.daysSinceLastCompleted, 3);
  assert.equal(overview.shouldRemind, true, "3 days equals remindAfterDays=3");

  later.planDay(1, "2026-07-25");
  assert.equal(later.getOverview(1).shouldRemind, true, "planned day does not suppress reminder");

  later.updateSettings(1, { dailyWeightTarget: 5, remindAfterDays: 5 });
  assert.equal(later.getOverview(1).shouldRemind, false, "threshold is configurable");
  assert.equal(exercise.id, 1);
});

test("fitness data stays isolated per user", () => {
  const db = createTestDatabase();
  const service = createService(db);
  service.createExercise(1, { name: "卧推" });
  assert.deepEqual(service.listExercises(2), []);
  assert.equal(service.getOverview(2).activeExercises, 0);
  assert.deepEqual(service.getCalendar(2, "2026-07").days, {});
  assert.throws(() => service.updateExercise(2, 1, { name: "偷改" }), FitnessError);
  assert.throws(() => service.startDay(2, TODAY), /no exercises/);
});

test("aerobic exercises validate type and default metrics", () => {
  const db = createTestDatabase();
  const service = createService(db);
  assert.throws(() => service.createExercise(1, { name: "跑步", type: "swimming" }), /type/);
  assert.throws(() => service.createExercise(1, { name: "跑步", type: "aerobic", defaultDurationMin: -1 }), /defaultDurationMin/);
  assert.throws(() => service.createExercise(1, { name: "跑步", type: "aerobic", defaultDistanceKm: 9999 }), /defaultDistanceKm/);
  assert.throws(() => service.createExercise(1, { name: "跑步", type: "aerobic", defaultIncline: 99 }), /defaultIncline/);

  const run = service.createExercise(1, {
    name: "跑步",
    type: "aerobic",
    defaultDurationMin: 30.25,
    defaultDistanceKm: "5.284",
    defaultIncline: 1.5
  });
  assert.equal(run.type, "aerobic");
  assert.equal(run.defaultDurationMin, 30.3);
  assert.equal(run.defaultDistanceKm, 5.28);
  assert.equal(run.defaultIncline, 1.5);
  assert.equal(run.sets, 3, "anaerobic fields stay available for aerobic rows");

  const updated = service.updateExercise(1, run.id, { defaultDurationMin: 45 });
  assert.equal(updated.defaultDurationMin, 45);
  assert.equal(updated.type, "aerobic");
});

test("aerobic days use single confirm instead of set checkmarks", () => {
  const db = createTestDatabase();
  const service = createService(db);
  service.createExercise(1, { name: "跑步", type: "aerobic", sets: 3, defaultDurationMin: 30, defaultDistanceKm: 5, defaultIncline: 1 });
  const { day } = { day: service.startDay(1, TODAY) };

  const aerobicItem = day.exercises[0];
  assert.equal(aerobicItem.type, "aerobic");
  assert.deepEqual(aerobicItem.results, []);
  assert.deepEqual(
    { completed: aerobicItem.aerobic.completed, durationMin: aerobicItem.aerobic.durationMin, distanceKm: aerobicItem.aerobic.distanceKm, incline: aerobicItem.aerobic.incline },
    { completed: false, durationMin: 30, distanceKm: 5, incline: 1 }
  );
  assert.equal(day.totalSets, 1, "aerobic item counts as one check unit");
  assert.equal(day.completedSets, 0);

  assert.throws(() => service.toggleSet(1, TODAY, aerobicItem.exerciseId, 0), /aerobic confirm endpoint/);
  assert.throws(() => service.setAerobicResult(1, "2026-07-21", aerobicItem.exerciseId, {}), /only allowed for today/);
  assert.throws(
    () => service.setAerobicResult(1, TODAY, aerobicItem.exerciseId, { durationMin: -5 }),
    /durationMin/
  );
  assert.throws(
    () => service.setAerobicResult(1, TODAY, aerobicItem.exerciseId, { avgHeartRate: 300 }),
    /avgHeartRate/
  );

  const confirmed = service.setAerobicResult(1, TODAY, aerobicItem.exerciseId, {
    completed: true,
    durationMin: 32.5,
    distanceKm: 6.1,
    incline: 2,
    avgHeartRate: 152,
    note: "  下雨改室内跑步机  "
  });
  assert.equal(confirmed.completed, true);
  assert.equal(confirmed.durationMin, 32.5);
  assert.equal(confirmed.distanceKm, 6.1);
  assert.equal(confirmed.avgHeartRate, 152);
  assert.equal(confirmed.note, "下雨改室内跑步机");
  assert.ok(confirmed.completedAt);

  const after = service.getDay(1, TODAY);
  assert.equal(after.completedSets, 1);
  assert.equal(after.exercises[0].aerobic.completed, true);
  assert.equal(after.exercises[0].aerobic.durationMin, 32.5);
  assert.equal(after.exercises[0].aerobic.avgHeartRate, 152);
  assert.equal(after.exercises[0].aerobic.note, "下雨改室内跑步机");

  const edited = service.setAerobicResult(1, TODAY, aerobicItem.exerciseId, { durationMin: 35 });
  assert.equal(edited.completed, true, "editing data keeps the checkmark");
  assert.equal(edited.durationMin, 35);

  const unchecked = service.setAerobicResult(1, TODAY, aerobicItem.exerciseId, { completed: false });
  assert.equal(unchecked.completed, false);
  assert.equal(unchecked.durationMin, 35, "unchecking keeps the last known data");
  assert.equal(unchecked.completedAt, null);
  assert.equal(service.getDay(1, TODAY).completedSets, 0);

  const finished = service.finishDay(1, TODAY);
  assert.equal(finished.status, "completed");
  service.reopenDay(1, TODAY);
  const reopened = service.getDay(1, TODAY);
  assert.equal(reopened.exercises[0].aerobic.durationMin, 35, "results survive reopen");
});

test("mixed anaerobic and aerobic day aggregates progress correctly", () => {
  const db = createTestDatabase();
  const service = createService(db, { random: () => 0 });
  const run = service.createExercise(1, { name: "跑步", type: "aerobic", defaultDurationMin: 30 });
  const lift = service.createExercise(1, { name: "卧推", type: "anaerobic", sets: 2 });
  service.updateSettings(1, { dailyWeightTarget: 50, remindAfterDays: 3 });
  const day = service.startDay(1, TODAY);
  assert.equal(day.totalSets, 3, "aerobic=1 + sets=2");

  service.setAerobicResult(1, TODAY, run.id, { completed: true, durationMin: 30, distanceKm: 5, incline: 0 });
  service.toggleSet(1, TODAY, lift.id, 0);
  const overview = service.getOverview(1);
  assert.equal(overview.today.completedSets, 2);
  assert.equal(overview.today.totalSets, 3);
});

test("deleting exercises keeps finished history intact", () => {
  const db = createTestDatabase();
  const service = createService(db);
  const run = service.createExercise(1, { name: "跑步", type: "aerobic", defaultDurationMin: 30, defaultDistanceKm: 5 });
  const lift = service.createExercise(1, { name: "卧推", sets: 2 });
  service.updateSettings(1, { dailyWeightTarget: 50, remindAfterDays: 3 });
  service.startDay(1, TODAY);
  service.setAerobicResult(1, TODAY, run.id, { completed: true, durationMin: 30, distanceKm: 5, incline: 0 });
  service.toggleSet(1, TODAY, lift.id, 0);
  service.finishDay(1, TODAY);

  service.deleteExercise(1, run.id);
  service.deleteExercise(1, lift.id);
  assert.deepEqual(service.listExercises(1), []);

  const detail = service.getDay(1, TODAY);
  assert.equal(detail.status, "completed");
  assert.equal(detail.exercises.length, 2, "snapshot survives hard delete");
  assert.equal(detail.exercises.find((item) => item.exerciseId === run.id).aerobic.completed, true);
  assert.equal(detail.exercises.find((item) => item.exerciseId === lift.id).results[0].completed, true);
  assert.equal(detail.completedSets, 2);

  const history = service.getHistory(1, TODAY, TODAY);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].completedSets, 2);
  assert.equal(history[0].exerciseCount, 2);
});

test("regenerate re-initializes aerobic results with defaults", () => {
  const db = createTestDatabase();
  const service = createService(db, { random: () => 0 });
  const run = service.createExercise(1, { name: "跑步", type: "aerobic", defaultDurationMin: 30, defaultDistanceKm: 5 });
  service.updateSettings(1, { dailyWeightTarget: 50, remindAfterDays: 3 });
  service.startDay(1, TODAY);
  service.setAerobicResult(1, TODAY, run.id, { completed: true, durationMin: 40, distanceKm: 7, incline: 1 });

  service.regenerateDay(1, TODAY);
  const day = service.getDay(1, TODAY);
  assert.equal(day.exercises[0].aerobic.completed, false);
  assert.equal(day.exercises[0].aerobic.durationMin, 30);
  assert.equal(day.exercises[0].aerobic.distanceKm, 5);
});

test("migration upgrades legacy fitness tables without data loss", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT);
    CREATE TABLE fitness_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sets INTEGER NOT NULL DEFAULT 3,
      reps INTEGER NOT NULL DEFAULT 12,
      weight_kg REAL NOT NULL DEFAULT 0,
      weight_mode TEXT NOT NULL DEFAULT 'total',
      priority_weight REAL NOT NULL DEFAULT 1,
      selection_count INTEGER NOT NULL DEFAULT 0,
      last_selected_date TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE fitness_workout_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workout_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      selected_exercises_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(user_id, workout_date)
    );
    CREATE TABLE fitness_set_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_day_id INTEGER NOT NULL REFERENCES fitness_workout_days(id) ON DELETE CASCADE,
      exercise_id INTEGER,
      set_index INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      UNIQUE(workout_day_id, exercise_id, set_index)
    );
  `);
  db.prepare("INSERT INTO users (id, login) VALUES (1, 'legacy')").run();
  db.prepare(
    "INSERT INTO fitness_exercises (user_id, name, sets, created_at, updated_at) VALUES (1, '旧卧推', 4, '2026-01-01', '2026-01-01')"
  ).run();

  migrateFitnessTables(db);
  migrateFitnessTables(db); // 幂等

  const columns = db.prepare("PRAGMA table_info(fitness_exercises)").all().map((column) => column.name);
  for (const column of ["type", "default_duration_min", "default_distance_km", "default_incline"]) {
    assert.ok(columns.includes(column), `fitness_exercises should gain ${column}`);
  }
  const legacy = db.prepare("SELECT * FROM fitness_exercises WHERE id = 1").get();
  assert.equal(legacy.name, "旧卧推");
  assert.equal(legacy.sets, 4);
  assert.equal(legacy.type, "anaerobic");
  assert.equal(legacy.default_duration_min, 30);
  assert.equal(legacy.default_distance_km, 5);
  assert.equal(legacy.default_incline, 0);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fitness%'")
    .all()
    .map((table) => table.name);
  assert.ok(tables.includes("fitness_aerobic_results"));
  const aerobicColumns = db.prepare("PRAGMA table_info(fitness_aerobic_results)").all().map((column) => column.name);
  for (const column of ["avg_heart_rate", "note"]) {
    assert.ok(aerobicColumns.includes(column), `fitness_aerobic_results should gain ${column}`);
  }
  const legacyService = createFitnessService({ db, today: () => TODAY });
  assert.equal(legacyService.listExercises(1)[0].type, "anaerobic", "legacy rows serve as anaerobic");
});

test("fitness surfaces are wired into navigation, api routes and checks", () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.match(html, /data-view-target="fitness"/);
  assert.match(html, /data-view-panel="fitness"/);
  assert.match(html, /fitness\.js/);

  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.match(app, /"overview", "activities", "foods", "devices", "display", "agent", "users", "fitness"/);

  const server = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  assert.match(server, /routeFitnessApi/);
  assert.match(server, /\/fitness\.js/);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.check, /src\/fitness\.js/);
  assert.match(pkg.scripts.check, /public\/fitness\.js/);
});

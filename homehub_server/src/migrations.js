"use strict";

function migrateFoodItemFields(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(food_items)").all().map((column) => column.name));
  if (!columns.has("location_text")) {
    db.exec("ALTER TABLE food_items ADD COLUMN location_text TEXT NOT NULL DEFAULT ''");
  }
}

function migrateFitnessTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fitness_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'anaerobic' CHECK (type IN ('anaerobic','aerobic')),
      sets INTEGER NOT NULL DEFAULT 3 CHECK (sets >= 1 AND sets <= 20),
      reps INTEGER NOT NULL DEFAULT 12 CHECK (reps >= 1 AND reps <= 500),
      weight_kg REAL NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
      weight_mode TEXT NOT NULL DEFAULT 'total' CHECK (weight_mode IN ('single','total')),
      default_duration_min REAL NOT NULL DEFAULT 30 CHECK (default_duration_min >= 0),
      default_distance_km REAL NOT NULL DEFAULT 5 CHECK (default_distance_km >= 0),
      default_incline REAL NOT NULL DEFAULT 0 CHECK (default_incline >= 0),
      priority_weight REAL NOT NULL DEFAULT 1 CHECK (priority_weight IN (0.5, 1, 1.5, 2)),
      selection_count INTEGER NOT NULL DEFAULT 0 CHECK (selection_count >= 0),
      last_selected_date TEXT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fitness_exercises_user ON fitness_exercises(user_id, archived, sort_order);
    CREATE TABLE IF NOT EXISTS fitness_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_weight_target REAL NOT NULL DEFAULT 5 CHECK (daily_weight_target >= 0.5),
      remind_after_days INTEGER NOT NULL DEFAULT 3 CHECK (remind_after_days >= 1 AND remind_after_days <= 365),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fitness_workout_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workout_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed')),
      selected_exercises_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(user_id, workout_date)
    );
    CREATE INDEX IF NOT EXISTS idx_fitness_workout_days_user ON fitness_workout_days(user_id, workout_date);
    CREATE TABLE IF NOT EXISTS fitness_set_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_day_id INTEGER NOT NULL REFERENCES fitness_workout_days(id) ON DELETE CASCADE,
      exercise_id INTEGER,
      set_index INTEGER NOT NULL CHECK (set_index >= 0),
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      completed_at TEXT,
      UNIQUE(workout_day_id, exercise_id, set_index)
    );
    CREATE TABLE IF NOT EXISTS fitness_aerobic_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_day_id INTEGER NOT NULL REFERENCES fitness_workout_days(id) ON DELETE CASCADE,
      exercise_id INTEGER,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      duration_min REAL NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
      distance_km REAL NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
      incline REAL NOT NULL DEFAULT 0 CHECK (incline >= 0),
      avg_heart_rate INTEGER NOT NULL DEFAULT 0 CHECK (avg_heart_rate >= 0 AND avg_heart_rate <= 250),
      note TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      UNIQUE(workout_day_id, exercise_id)
    );
  `);
  migrateFitnessExerciseColumns(db);
  migrateFitnessAerobicColumns(db);
}

function migrateFitnessExerciseColumns(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(fitness_exercises)").all().map((column) => column.name));
  if (!columns.has("type")) {
    db.exec("ALTER TABLE fitness_exercises ADD COLUMN type TEXT NOT NULL DEFAULT 'anaerobic' CHECK (type IN ('anaerobic','aerobic'))");
  }
  if (!columns.has("default_duration_min")) {
    db.exec("ALTER TABLE fitness_exercises ADD COLUMN default_duration_min REAL NOT NULL DEFAULT 30 CHECK (default_duration_min >= 0)");
  }
  if (!columns.has("default_distance_km")) {
    db.exec("ALTER TABLE fitness_exercises ADD COLUMN default_distance_km REAL NOT NULL DEFAULT 5 CHECK (default_distance_km >= 0)");
  }
  if (!columns.has("default_incline")) {
    db.exec("ALTER TABLE fitness_exercises ADD COLUMN default_incline REAL NOT NULL DEFAULT 0 CHECK (default_incline >= 0)");
  }
}

function migrateFitnessAerobicColumns(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(fitness_aerobic_results)").all().map((column) => column.name));
  if (!columns.has("avg_heart_rate")) {
    db.exec("ALTER TABLE fitness_aerobic_results ADD COLUMN avg_heart_rate INTEGER NOT NULL DEFAULT 0 CHECK (avg_heart_rate >= 0 AND avg_heart_rate <= 250)");
  }
  if (!columns.has("note")) {
    db.exec("ALTER TABLE fitness_aerobic_results ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
}

module.exports = { migrateFitnessTables, migrateFoodItemFields };

"use strict";

// Smart schedule for e-paper devices.
//
// The server owns the policy; the device only follows one number
// (X-Next-Check-Seconds). A day is split into one busy window [start, end) and an
// idle window covering everything else, so the two windows always tile 24 hours.
// Crossing midnight is expressed with busyStart > busyEnd.

const MINUTES_PER_DAY = 1440;
const MIN_SEGMENT_MINUTES = 5;
const MIN_INTERVAL_SECONDS = 300;
const MAX_INTERVAL_SECONDS = 1440 * 60;

// Buffer added whenever the next wake-up lands on a window boundary: it makes sure
// the device wakes up after the server has already switched windows.
const SCHEDULE_BOUNDARY_BUFFER_SECONDS = 10;

// Only these values are selectable in the UI.
const SCHEDULE_INTERVAL_OPTIONS_SECONDS = [300, 600, 900, 1200, 1800, 3600, 7200];

const DEFAULT_SCHEDULE = {
  enabled: false,
  busyStartMinute: 420, // 07:00
  busyEndMinute: 1380, // 23:00
  busyIntervalSeconds: 1800,
  idleIntervalSeconds: 0 // 0 = do not refresh during the idle window
};

function localClockParts(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const hour = Number(values.hour ?? 0) % 24;
  const minute = Number(values.minute ?? 0);
  const second = Number(values.second ?? 0);
  return { hour, minute, second, minutes: hour * 60 + minute };
}

function segmentMinutes(startMinute, endMinute) {
  const span = (endMinute - startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return span === 0 ? MINUTES_PER_DAY : span;
}

function isBusyMinute(busyStartMinute, busyEndMinute, minuteOfDay) {
  if (busyStartMinute < busyEndMinute) {
    return minuteOfDay >= busyStartMinute && minuteOfDay < busyEndMinute;
  }
  // Crossing midnight (or a busy window covering the whole day when equal).
  return minuteOfDay >= busyStartMinute || minuteOfDay < busyEndMinute;
}

// Returns the seconds the device should sleep, or 0 when the server must not send
// the header at all (smart schedule disabled).
function scheduleHint(device, clock) {
  if (!device || !device.smart_schedule_enabled) return 0;
  const busyStart = Number(device.busy_start_minute ?? DEFAULT_SCHEDULE.busyStartMinute);
  const busyEnd = Number(device.busy_end_minute ?? DEFAULT_SCHEDULE.busyEndMinute);
  const inBusy = isBusyMinute(busyStart, busyEnd, clock.minutes);
  const interval = inBusy
    ? Number(device.busy_interval_seconds ?? DEFAULT_SCHEDULE.busyIntervalSeconds)
    : Number(device.idle_interval_seconds ?? DEFAULT_SCHEDULE.idleIntervalSeconds);
  const boundary = inBusy ? busyEnd : busyStart;
  let deltaMinutes = (boundary - clock.minutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (deltaMinutes === 0) deltaMinutes = MINUTES_PER_DAY;
  const untilBoundary = deltaMinutes * 60 - clock.second;
  // "No refresh" (0) or an interval that would cross the boundary: sleep exactly
  // until the boundary, plus the buffer so the next request lands in the new window.
  if (interval <= 0 || interval >= untilBoundary) {
    return untilBoundary + SCHEDULE_BOUNDARY_BUFFER_SECONDS;
  }
  return interval;
}

function snapDownToOption(seconds) {
  let best = 0;
  for (const option of SCHEDULE_INTERVAL_OPTIONS_SECONDS) {
    if (option <= seconds) best = option;
  }
  return best;
}

// Clamps the plain check interval (used when the smart schedule is off).
function clampCheckIntervalMinutes(value, fallback = 30) {
  if (value === null || value === undefined || value === "") return fallback;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  const rounded = Math.round(minutes);
  if (rounded < MIN_INTERVAL_SECONDS / 60) return MIN_INTERVAL_SECONDS / 60;
  if (rounded > MAX_INTERVAL_SECONDS / 60) return MAX_INTERVAL_SECONDS / 60;
  return rounded;
}

// Keeps a value inside [0, segmentLength]: 0 (no refresh) is always allowed, other
// values must be one of the selectable options and must fit inside the window.
function clampIntervalToSegment(seconds, segmentLengthMinutes) {
  const limit = segmentLengthMinutes * 60;
  const snapped = snapDownToOption(seconds);
  if (snapped <= limit) return snapped;
  let best = 0;
  for (const option of SCHEDULE_INTERVAL_OPTIONS_SECONDS) {
    if (option <= limit) best = option;
  }
  return best;
}

function toMinuteOfDay(value, fallback) {
  // JSON null (an unset or invalid form field) must fall back, not become midnight:
  // Number(null) === 0 would otherwise silently store 00:00.
  if (value === null || value === undefined || value === "") return fallback;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  const rounded = Math.round(minutes);
  if (rounded < 0 || rounded >= MINUTES_PER_DAY) return fallback;
  return rounded;
}

// Validates and clamps a client payload. Returns the settings that are actually
// stored, so the caller can echo them back instead of silently keeping bad input.
function normalizeScheduleSettings(input = {}, current = DEFAULT_SCHEDULE) {
  const enabled = input.enabled === undefined ? Boolean(current.enabled) : Boolean(input.enabled);
  const busyStartMinute = toMinuteOfDay(input.busyStartMinute, current.busyStartMinute);
  const busyEndMinute = toMinuteOfDay(input.busyEndMinute, current.busyEndMinute);
  const busySegment = segmentMinutes(busyStartMinute, busyEndMinute);
  const idleSegment = MINUTES_PER_DAY - busySegment;

  if (busySegment < MIN_SEGMENT_MINUTES) {
    const error = new Error("busy window must be at least 5 minutes");
    error.statusCode = 400;
    throw error;
  }

  const busyIntervalSeconds = clampIntervalToSegment(
    input.busyIntervalSeconds === undefined || input.busyIntervalSeconds === null
      ? current.busyIntervalSeconds
      : Number(input.busyIntervalSeconds),
    busySegment
  );
  const idleIntervalSeconds = idleSegment < MIN_SEGMENT_MINUTES
    ? 0
    : clampIntervalToSegment(
      input.idleIntervalSeconds === undefined || input.idleIntervalSeconds === null
        ? current.idleIntervalSeconds
        : Number(input.idleIntervalSeconds),
      idleSegment
    );

  return {
    enabled,
    busyStartMinute,
    busyEndMinute,
    busyIntervalSeconds,
    idleIntervalSeconds
  };
}

// Pure decision step used by the frame endpoint: what to send back.
//
// The server is authoritative for the stored interval. A device-side change is
// simply rolled back on the next request: the device reports its value, the server
// answers with its own, and the device overwrites its NVS. A report that cannot be
// applied (invalid value, or no report at all) is ignored; there is no retry loop
// because the device always reports again on the next wake.
function resolveScheduleReply({ device, reportedIntervalMinutes = 0, clock, timezone }) {
  const headers = {};
  const checkIntervalMinutes = Number(device.check_interval_minutes ?? 30);
  const reportedIsValid =
    reportedIntervalMinutes >= MIN_INTERVAL_SECONDS / 60 &&
    reportedIntervalMinutes <= MAX_INTERVAL_SECONDS / 60;

  if (reportedIsValid && reportedIntervalMinutes !== checkIntervalMinutes) {
    headers["X-Check-Interval-Seconds"] = String(checkIntervalMinutes * 60);
  }

  const hint = scheduleHint(device, clock ?? localClockParts(timezone));
  if (hint > 0) headers["X-Next-Check-Seconds"] = String(hint);

  return { headers, checkIntervalMinutes };
}

module.exports = {
  DEFAULT_SCHEDULE,
  MIN_SEGMENT_MINUTES,
  SCHEDULE_BOUNDARY_BUFFER_SECONDS,
  SCHEDULE_INTERVAL_OPTIONS_SECONDS,
  clampCheckIntervalMinutes,
  clampIntervalToSegment,
  isBusyMinute,
  localClockParts,
  normalizeScheduleSettings,
  resolveScheduleReply,
  scheduleHint,
  segmentMinutes
};

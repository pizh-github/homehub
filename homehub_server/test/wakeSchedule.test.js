"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SCHEDULE,
  SCHEDULE_BOUNDARY_BUFFER_SECONDS,
  clampCheckIntervalMinutes,
  clampIntervalToSegment,
  localClockParts,
  normalizeScheduleSettings,
  resolveScheduleReply,
  scheduleHint,
  segmentMinutes
} = require("../src/wakeSchedule");

function device(overrides = {}) {
  return {
    smart_schedule_enabled: 1,
    busy_start_minute: 420, // 07:00
    busy_end_minute: 1380, // 23:00
    busy_interval_seconds: 1800,
    idle_interval_seconds: 0,
    check_interval_minutes: 30,
    ...overrides
  };
}

function clock(hour, minute, second = 0) {
  return { hour, minute, second, minutes: hour * 60 + minute };
}

test("smart schedule disabled sends no hint at all", () => {
  assert.equal(scheduleHint(device({ smart_schedule_enabled: 0 }), clock(8, 0)), 0);
  assert.equal(scheduleHint(null, clock(8, 0)), 0);
});

test("busy window uses the busy interval", () => {
  assert.equal(scheduleHint(device(), clock(8, 0)), 1800);
  assert.equal(scheduleHint(device(), clock(22, 45)), 910); // 900 s to the boundary + 10 s
});

test("idle window with no-refresh sleeps until the window ends", () => {
  // 23:30 -> 07:00 is 450 minutes.
  assert.equal(scheduleHint(device(), clock(23, 30)), 450 * 60 + SCHEDULE_BOUNDARY_BUFFER_SECONDS);
});

test("idle window with 120 minutes only sleeps to the boundary", () => {
  // Busy 10:00-01:00 leaves the idle window 01:00-10:00.
  const settings = device({
    busy_start_minute: 600,
    busy_end_minute: 60,
    busy_interval_seconds: 1800,
    idle_interval_seconds: 7200
  });
  assert.equal(scheduleHint(settings, clock(1, 0)), 7200); // 9 h ahead, plain interval wins
  assert.equal(scheduleHint(settings, clock(5, 0)), 7200);
  assert.equal(scheduleHint(settings, clock(7, 0)), 7200);
  // 09:00 -> 01:00 of the next day is 1 h: sleep to the boundary instead of 2 h.
  assert.equal(scheduleHint(settings, clock(9, 0)), 3600 + SCHEDULE_BOUNDARY_BUFFER_SECONDS);
});

test("busy window crossing midnight is handled in both directions", () => {
  const settings = device({ busy_start_minute: 1320, busy_end_minute: 360 }); // 22:00-06:00
  assert.equal(scheduleHint(settings, clock(23, 0)), 1800);
  assert.equal(scheduleHint(settings, clock(5, 0)), 1800);
  // 08:00 is idle; the idle window ends at 22:00.
  assert.equal(scheduleHint(settings, clock(8, 0)), 14 * 3600 + SCHEDULE_BOUNDARY_BUFFER_SECONDS);
});

test("the exact boundary minute already belongs to the next window", () => {
  // busy 07:00-23:00: 23:00 is the first idle minute.
  const settings = device({ busy_end_minute: 1380 });
  assert.equal(scheduleHint(settings, clock(22, 59)), 60 + SCHEDULE_BOUNDARY_BUFFER_SECONDS);
  assert.equal(scheduleHint(settings, clock(23, 0)), 8 * 3600 + SCHEDULE_BOUNDARY_BUFFER_SECONDS);
});

test("segment length is computed across midnight", () => {
  assert.equal(segmentMinutes(420, 1380), 960);
  assert.equal(segmentMinutes(1380, 420), 480);
  assert.equal(segmentMinutes(420, 420), 1440);
});

test("selectable intervals are snapped and clamped to the window length", () => {
  // 420 s is not a selectable option.
  assert.equal(clampIntervalToSegment(420, 1000), 300);
  // A 40 minute window cannot hold 60 or 120 minutes.
  assert.equal(clampIntervalToSegment(7200, 40), 1800);
  assert.equal(clampIntervalToSegment(3600, 40), 1800);
  // "No refresh" is always allowed.
  assert.equal(clampIntervalToSegment(0, 40), 0);

  const normalized = normalizeScheduleSettings({
    enabled: true,
    busyStartMinute: 600,
    busyEndMinute: 640,
    busyIntervalSeconds: 7200,
    idleIntervalSeconds: 7200
  });
  assert.equal(normalized.busyIntervalSeconds, 1800);
  assert.equal(normalized.idleIntervalSeconds, 7200);
});

test("a busy window shorter than five minutes is rejected", () => {
  assert.throws(() => normalizeScheduleSettings({
    enabled: true,
    busyStartMinute: 600,
    busyEndMinute: 603
  }), /at least 5 minutes/);
});

test("null and empty fields fall back instead of becoming midnight", () => {
  const normalized = normalizeScheduleSettings(
    {
      enabled: true,
      busyStartMinute: null,
      busyEndMinute: "",
      busyIntervalSeconds: null,
      idleIntervalSeconds: null
    },
    { enabled: true, busyStartMinute: 480, busyEndMinute: 1320, busyIntervalSeconds: 600, idleIntervalSeconds: 7200 }
  );
  assert.equal(normalized.busyStartMinute, 480);
  assert.equal(normalized.busyEndMinute, 1320);
  assert.equal(normalized.busyIntervalSeconds, 600);
  assert.equal(normalized.idleIntervalSeconds, 7200);
});

test("out of range minutes fall back to the current value", () => {
  const normalized = normalizeScheduleSettings(
    { enabled: true, busyStartMinute: -5, busyEndMinute: 5000 },
    DEFAULT_SCHEDULE
  );
  assert.equal(normalized.busyStartMinute, DEFAULT_SCHEDULE.busyStartMinute);
  assert.equal(normalized.busyEndMinute, DEFAULT_SCHEDULE.busyEndMinute);
});

test("a full day busy window leaves no idle window", () => {
  const normalized = normalizeScheduleSettings({
    enabled: true,
    busyStartMinute: 480,
    busyEndMinute: 480,
    busyIntervalSeconds: 1800,
    idleIntervalSeconds: 7200
  });
  assert.equal(normalized.idleIntervalSeconds, 0);
});

test("the server interval wins: a device-side change is rolled back", () => {
  const reply = resolveScheduleReply({
    device: device({ check_interval_minutes: 30, smart_schedule_enabled: 0 }),
    reportedIntervalMinutes: 60,
    clock: clock(8, 0)
  });
  // Stored value is 30, device reports 60 -> the stored value is handed back.
  assert.equal(reply.headers["X-Check-Interval-Seconds"], "1800");
  assert.equal(reply.checkIntervalMinutes, 30);
});

test("no interval header while the device already matches the stored value", () => {
  const reply = resolveScheduleReply({
    device: device({ check_interval_minutes: 60 }),
    reportedIntervalMinutes: 60,
    clock: clock(8, 0)
  });
  assert.equal(reply.headers["X-Check-Interval-Seconds"], undefined);
  assert.equal(reply.headers["X-Next-Check-Seconds"], "1800");
});

test("an unreported or implausible interval never triggers a rollback", () => {
  for (const reported of [0, -5, 99999, Number.NaN]) {
    const reply = resolveScheduleReply({
      device: device({ check_interval_minutes: 30 }),
      reportedIntervalMinutes: reported,
      clock: clock(8, 0)
    });
    assert.equal(reply.headers["X-Check-Interval-Seconds"], undefined, `reported=${reported}`);
    assert.equal(reply.checkIntervalMinutes, 30);
  }
});

test("local clock parts follow the configured timezone", () => {
  const shanghai = localClockParts("Asia/Shanghai", new Date("2026-01-01T00:00:00Z"));
  assert.equal(shanghai.hour, 8);
  assert.equal(shanghai.minutes, 8 * 60);
  const utc = localClockParts("UTC", new Date("2026-01-01T00:00:00Z"));
  assert.equal(utc.hour, 0);
  assert.equal(utc.minutes, 0);
});

test("the plain check interval is clamped to the hardware range", () => {
  assert.equal(clampCheckIntervalMinutes(30), 30);
  assert.equal(clampCheckIntervalMinutes(1), 5);
  assert.equal(clampCheckIntervalMinutes(99999), 1440);
  assert.equal(clampCheckIntervalMinutes("60"), 60);
  assert.equal(clampCheckIntervalMinutes(Number.NaN, 30), 30);
  assert.equal(clampCheckIntervalMinutes(undefined, 45), 45);
  assert.equal(clampCheckIntervalMinutes(null, 45), 45);
  assert.equal(clampCheckIntervalMinutes("", 45), 45);
});

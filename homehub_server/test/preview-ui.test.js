"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const publicDir = path.resolve(__dirname, "..", "public");

test("display preview panel selector lists the 7.5-inch tri-color panel", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

  assert.match(html, /<option value="gdey075z08">GDEY075Z08 7\.5 寸三色<\/option>/);
  assert.doesNotMatch(html, /30 分钟|设备常规定时检查/);
});

test("display preview metadata handles 7.5-inch tri-color without four-color labels", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");

  assert.match(app, /PREVIEW_PANEL_METADATA/);
  assert.match(app, /gdey075z08: \{ width: 800, height: 480, colorMode: "tri-color", landscapeRows: 8, portraitRows: 9, frameBytes: "96 KB" \}/);
  assert.match(app, /previewPanelMetadata\(panel\)/);
  assert.doesNotMatch(app, /const isTriColor = panel === "gdey042z98"/);
});

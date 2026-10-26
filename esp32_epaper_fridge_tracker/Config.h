#pragma once

#include <Arduino.h>
#include "HardwareConfig.h"

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM0397F81
static const char* PANEL_PROFILE = "gdem0397f81";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
static const char* PANEL_PROFILE = "gdey042z98";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
static const char* PANEL_PROFILE = "gdey075z08";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F52
static const char* PANEL_PROFILE = "gdem075f52";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F53
// The server frame remains 800x480 2bpp-bwyr (96,000 bytes).
static const char* PANEL_PROFILE = "gdem075f53";
#else
  #error "Unsupported FRIDGE_PANEL_TYPE"
#endif

static const char* DEVICE_NAME = FRIDGE_DEVICE_NAME;
static const char* PROVISIONING_AP_PREFIX = "XianZhiTie-";
static const char* DEFAULT_API_BASE_URL = "https://fridge.followllm.online";
static const uint8_t PROVISIONING_AP_CHANNEL = 1;
static const uint8_t PROVISIONING_AP_MAX_CLIENTS = 4;

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
static const uint16_t DISPLAY_WIDTH = 400;
static const uint16_t DISPLAY_HEIGHT = 300;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 7) / 8;
static const size_t DISPLAY_PLANE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
static const size_t DISPLAY_IMAGE_BYTES = DISPLAY_PLANE_BYTES * 2;
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
// 800x480 black/white/red: one bit per pixel per plane, two planes per frame.
static const uint16_t DISPLAY_WIDTH = 800;
static const uint16_t DISPLAY_HEIGHT = 480;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 7) / 8;
static const size_t DISPLAY_PLANE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
static const size_t DISPLAY_IMAGE_BYTES = DISPLAY_PLANE_BYTES * 2;
#else
static const uint16_t DISPLAY_WIDTH = 800;
static const uint16_t DISPLAY_HEIGHT = 480;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 3) / 4;
static const size_t DISPLAY_PLANE_BYTES = 0;
static const size_t DISPLAY_IMAGE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
#endif
// C3 keeps a small page buffer in internal SRAM. S3 retains the larger buffer
// used by the original PSRAM-backed firmware.
#if FRIDGE_BOARD_ESP32C3
static const uint16_t DISPLAY_PAGE_HEIGHT = 30;
#else
static const uint16_t DISPLAY_PAGE_HEIGHT = DISPLAY_HEIGHT / 2;
#endif
static const uint16_t DISPLAY_DRAW_CHUNK_ROWS = 20;
static const size_t DISPLAY_DRAW_CHUNK_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_DRAW_CHUNK_ROWS;

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98 || FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
static const char* IMAGE_PATH = "/fridge3c.bin";
static const char* TEMP_IMAGE_PATH = "/fridge3c.tmp";
static const char* BACKUP_IMAGE_PATH = "/fridge3c.bak";
#else
static const char* IMAGE_PATH = "/fridge4c.bin";
static const char* TEMP_IMAGE_PATH = "/fridge4c.tmp";
static const char* BACKUP_IMAGE_PATH = "/fridge4c.bak";
#endif

static const uint32_t DEFAULT_CHECK_INTERVAL_MINUTES = 30;
static const uint32_t MIN_CHECK_INTERVAL_MINUTES = 5;
static const uint32_t MAX_CHECK_INTERVAL_MINUTES = 24UL * 60UL;
static const uint64_t FIRST_SETUP_RETRY_INTERVAL_US = 2ULL * 60ULL * 1000000ULL; // backoff seed, see BACKOFF_MIN_SECONDS
static const uint32_t WIFI_TIMEOUT_MS = 20000; // conservative budget until the device is registered
static const uint32_t WIFI_TIMEOUT_MS_LOCAL = 8000;
static const uint32_t WIFI_TIMEOUT_MS_PUBLIC = 10000;
static const uint32_t WIFI_FAST_CONNECT_TIMEOUT_MS = 5000; // cached-channel attempt before a full scan
static const uint32_t WIFI_MODEM_SLEEP_AFTER_MS = 4000; // start napping only once the wait goes long
static const uint32_t BACKOFF_MIN_SECONDS = 120; // first retry delay; grows until it reaches interval
// Not a policy limit: the hardware follows whatever the server asks for. This only
// rejects absurd values (parsing errors) that would park the device for good.
static const uint32_t SMART_HINT_SANITY_MAX_SECONDS = 7UL * 24UL * 60UL * 60UL;
static const uint8_t BATTERY_SAMPLE_REQUESTS = 50; // sample every N frame requests (~1 day at 30 min)
static const uint8_t BATTERY_PERCENT_UNKNOWN = 0xFF;
static const uint32_t WIFI_MODE_TRANSITION_DELAY_MS = 100;
static const uint32_t WIFI_AP_RETRY_DELAY_MS = 250;
static const uint32_t DOWNLOAD_TIMEOUT_MS = 25000;
static const uint32_t MAX_POWER_ON_PORTAL_TIMEOUT_MS = 10UL * 60UL * 1000UL;
static const uint64_t CONFIG_APPLY_RESTART_DELAY_US = 1ULL * 1000000ULL;
static const uint32_t SERIAL_BOOT_DELAY_MS = 2500; // also the window for holding BOOT to clear settings
static const uint32_t TIMER_WAKE_SERIAL_DELAY_MS = 100; // timer wakes need no boot window
static const uint32_t SERIAL_SLEEP_DELAY_MS = 750;
static const uint32_t SERIAL_BAUD_RATE = 115200;

// NVS keys. Never reuse an existing key name for a new meaning.
static const char* WIFI_CHANNEL_KEY = "wch";
static const char* FAIL_COUNT_KEY = "failcount";
static const char* SCREEN_FINGERPRINT_KEY = "screenfp";
static const char* REQUEST_COUNT_KEY = "reqcount";
static const char* BATTERY_PERCENT_KEY = "batpct";
static const char* BATTERY_SAMPLED_AT_KEY = "batat";

// Local development commonly uses HTTP. When later using HTTPS, provision a
// trusted endpoint or replace this prototype setting with CA validation.
static const bool ALLOW_INSECURE_HTTPS = true;

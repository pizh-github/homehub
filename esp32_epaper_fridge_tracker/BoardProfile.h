#pragma once

#include <Arduino.h>
#include "HardwareConfig.h"

#if CONFIG_IDF_TARGET_ESP32C3

#define FRIDGE_BOARD_ESP32C3 1
#define FRIDGE_BOARD_ESP32S3 0

#if FRIDGE_C3_BOARD_TYPE == FRIDGE_C3_BOARD_MOYU_AI_V111

#define FRIDGE_BOARD_NAME "Moyu AI V1.1.1"
#define FRIDGE_DEVICE_NAME "XianZhi Tie Moyu"

// Moyu AI V1.1.1 integrated e-paper SPI pins and BOOT button.
static const int EPD_CS = 7;
static const int EPD_DC = 1;
static const int EPD_RST = 2;
static const int EPD_BUSY = 10;
static const int EPD_SCK = 4;
static const int EPD_MOSI = 6;
static const int EPD_MISO = -1;
static const int EPD_PWR = 0; // panel LDO enable, HIGH = power on
static const int BAT_ADC_PIN = 3; // battery voltage divider (10k/10k, read = Vbat / 2)
static const int BAT_ADC_CONTROL_PIN = 8; // pull LOW while sampling battery ADC
static const int CONFIG_BUTTON_PIN = 9;

#elif FRIDGE_C3_BOARD_TYPE == FRIDGE_C3_BOARD_SUPER_MINI

#define FRIDGE_BOARD_NAME "ESP32-C3 Super Mini"
#define FRIDGE_DEVICE_NAME "XianZhi Tie C3"

static const int EPD_CS = 7;
static const int EPD_DC = 3;
static const int EPD_RST = 5;
static const int EPD_BUSY = 10;
static const int EPD_SCK = 4;
static const int EPD_MOSI = 6;
static const int EPD_MISO = -1;
static const int EPD_PWR = -1; // Super Mini has no panel LDO control pin
static const int BAT_ADC_PIN = -1; // no battery voltage divider
static const int BAT_ADC_CONTROL_PIN = -1;
static const int CONFIG_BUTTON_PIN = 0;

#else

#error "Unsupported FRIDGE_C3_BOARD_TYPE"

#endif

// The supported C3 boards have no PSRAM, so four-color frames are read from
// FFat in small chunks. Reduced TX power also lowers peak current on this board.
#define FRIDGE_USE_CHUNKED_4C_DRAW 1
#define FRIDGE_LIMIT_WIFI_TX_POWER 1

#elif CONFIG_IDF_TARGET_ESP32S3

#define FRIDGE_BOARD_ESP32C3 0
#define FRIDGE_BOARD_ESP32S3 1
#define FRIDGE_BOARD_NAME "ESP32-S3 N16R8"
#define FRIDGE_DEVICE_NAME "XianZhi Tie S3"

static const int EPD_CS = 10;
static const int EPD_DC = 8;
static const int EPD_RST = 7;
static const int EPD_BUSY = 9;
static const int EPD_SCK = 12;
static const int EPD_MOSI = 11;
static const int EPD_MISO = -1;
static const int EPD_PWR = -1; // S3 board has no panel LDO control pin
static const int BAT_ADC_PIN = -1; // no battery voltage divider
static const int BAT_ADC_CONTROL_PIN = -1;
static const int CONFIG_BUTTON_PIN = 0;

// Keep the established S3 path: load a four-color frame into PSRAM and pass it
// to drawNative() in one call. Wi-Fi uses the board/core default TX power.
#define FRIDGE_USE_CHUNKED_4C_DRAW 0
#define FRIDGE_LIMIT_WIFI_TX_POWER 0

#else

#error "Unsupported ESP32 target; select an ESP32-C3 or ESP32-S3 board"

#endif

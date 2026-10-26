#pragma once

// C3 board selection is independent of the processor selected in Arduino IDE.
// ESP32-S3 builds ignore this setting.
// The local ESP32-C3-WROOM-02 e-paper board uses the Moyu AI V1.1.1 pinout:
//   CS=7, DC=1, RST=2, BUSY=10, SCK=4, MOSI=6, panel LDO enable=0.
#define FRIDGE_C3_BOARD_SUPER_MINI 0
#define FRIDGE_C3_BOARD_MOYU_AI_V111 1
#ifndef FRIDGE_C3_BOARD_TYPE
#define FRIDGE_C3_BOARD_TYPE FRIDGE_C3_BOARD_MOYU_AI_V111
#endif

// Select exactly one physical panel; F53 uses JD79665CA, not F52's controller.
#define FRIDGE_PANEL_GDEM075F52 0
#define FRIDGE_PANEL_GDEM0397F81 1
#define FRIDGE_PANEL_GDEY042Z98 2
#define FRIDGE_PANEL_GDEM075F53 3
#define FRIDGE_PANEL_GDEY075Z08 4
#ifndef FRIDGE_PANEL_TYPE
// Local panel: 7.5" 800x480 black/white/red UC8179 (GxEPD2 GDEY075Z08 driver).
#define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEY075Z08
#endif

#include "GxEPD2_750c_GDEM075F53.h"

namespace {

constexpr uint16_t F53_POWER_ON_TIME_MS = 200;
constexpr uint16_t F53_FULL_REFRESH_TIME_MS = 20000;

} // namespace

GxEPD2_750c_GDEM075F53::GxEPD2_750c_GDEM075F53(
  int16_t cs,
  int16_t dc,
  int16_t rst,
  int16_t busy
) :
  GxEPD2_750c_GDEM075F52(cs, dc, rst, busy),
  pagedWrite_(false),
  nextPagedRow_(0)
{
}

void GxEPD2_750c_GDEM075F53::initDisplay()
{
  // Good Display A32-GDEM075F53 sample, JD79665CA, 2026-07-09.
  // The panel requires re-initialization before every full-screen update.
  // Good Display recommends input pull-up when BUSY remains asserted. The
  // official adapter provides this externally, while direct ESP32 boards may
  // otherwise leave the active-low BUSY signal without a reliable idle level.
  if (_busy >= 0)
  {
    pinMode(_busy, INPUT_PULLUP);
  }
  delay(100);
  if (_rst >= 0)
  {
    digitalWrite(_rst, LOW);
    delay(10);
    digitalWrite(_rst, HIGH);
    delay(10);
  }
  waitForReady("reset", F53_POWER_ON_TIME_MS);

  _writeCommand(0x4D);
  _writeData(0x78);

  _writeCommand(0x00);
  _writeData(0x2F);
  _writeData(0x29);

  _writeCommand(0xE3);
  _writeData(0x88);

  _writeCommand(0x50);
  _writeData(0x37);

  _writeCommand(0x61);
  _writeData(WIDTH / 256);
  _writeData(WIDTH % 256);
  _writeData(HEIGHT / 256);
  _writeData(HEIGHT % 256);

  _writeCommand(0x65);
  _writeData(0x00);
  _writeData(0x00);
  _writeData(0x00);
  _writeData(0x00);

  _writeCommand(0xE9);
  _writeData(0x01);

  _writeCommand(0xF0);
  _writeData(0x5F);

  _writeCommand(0x30);
  _writeData(0x08);

  _writeCommand(0x04);
  waitForReady("power on", F53_POWER_ON_TIME_MS);

  _hibernating = false;
  _power_is_on = true;
  _init_display_done = true;
}

void GxEPD2_750c_GDEM075F53::setPaged()
{
  initDisplay();
  _writeCommand(0x10);
  pagedWrite_ = true;
  nextPagedRow_ = 0;
}

void GxEPD2_750c_GDEM075F53::writeNative(
  const uint8_t* data1,
  const uint8_t* data2,
  int16_t x,
  int16_t y,
  int16_t w,
  int16_t h,
  bool invert,
  bool mirrorY,
  bool pgm
)
{
  (void)data2;
  if (!data1 || x != 0 || w != int16_t(WIDTH) || y < 0 || h <= 0 || y + h > int16_t(HEIGHT))
  {
    return;
  }

  if (pagedWrite_)
  {
    if (y != int16_t(nextPagedRow_))
    {
      pagedWrite_ = false;
      return;
    }
  }
  else
  {
    // Outside paged mode only a complete native frame is safe. The vendor
    // example does not document random-access RAM window commands for F53.
    if (y != 0 || h != int16_t(HEIGHT))
    {
      return;
    }
    initDisplay();
    _writeCommand(0x10);
  }

  const size_t bytesPerRow = WIDTH / 4;
  _startTransfer();
  for (int16_t row = 0; row < h; row++)
  {
    const int16_t sourceRow = mirrorY ? h - 1 - row : row;
    const size_t rowOffset = size_t(sourceRow) * bytesPerRow;
    for (size_t column = 0; column < bytesPerRow; column++)
    {
      uint8_t data;
      if (pgm)
      {
#if defined(__AVR) || defined(ESP8266) || defined(ESP32)
        data = pgm_read_byte(&data1[rowOffset + column]);
#else
        data = data1[rowOffset + column];
#endif
      }
      else
      {
        data = data1[rowOffset + column];
      }
      _transfer(invert ? invertNative(data) : data);
    }
  }
  _endTransfer();

  if (pagedWrite_)
  {
    nextPagedRow_ += h;
    if (nextPagedRow_ == HEIGHT)
    {
      pagedWrite_ = false;
      _initial_write = false;
    }
  }
  else
  {
    _initial_write = false;
    nextPagedRow_ = HEIGHT;
  }
  delay(1);
}

void GxEPD2_750c_GDEM075F53::drawNative(
  const uint8_t* data1,
  const uint8_t* data2,
  int16_t x,
  int16_t y,
  int16_t w,
  int16_t h,
  bool invert,
  bool mirrorY,
  bool pgm
)
{
  writeNative(data1, data2, x, y, w, h, invert, mirrorY, pgm);
  refresh(false);
}

void GxEPD2_750c_GDEM075F53::refresh(bool partialUpdateMode)
{
  (void)partialUpdateMode;
  if (pagedWrite_ || nextPagedRow_ != HEIGHT)
  {
    return;
  }

  _writeCommand(0x12);
  _writeData(0x00);
  delay(1);
  waitForReady("refresh", F53_FULL_REFRESH_TIME_MS);
  _init_display_done = false;
  nextPagedRow_ = 0;
}

void GxEPD2_750c_GDEM075F53::refresh(int16_t x, int16_t y, int16_t w, int16_t h)
{
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  refresh(false);
}

void GxEPD2_750c_GDEM075F53::waitForReady(const char* stage, uint16_t busyTimeMs)
{
  Serial.print("F53 BUSY before ");
  Serial.print(stage);
  Serial.print(": ");
  Serial.println(_busy >= 0 ? digitalRead(_busy) : -1);
  _waitWhileBusy(stage, busyTimeMs);
  Serial.print("F53 BUSY after ");
  Serial.print(stage);
  Serial.print(": ");
  Serial.println(_busy >= 0 ? digitalRead(_busy) : -1);
}

uint8_t GxEPD2_750c_GDEM075F53::invertNative(uint8_t data) const
{
  uint8_t result = 0;
  for (uint8_t index = 0; index < 4; index++)
  {
    const uint8_t color = (data >> (6 - index * 2)) & 0x03;
    const uint8_t inverted = (color + 1) & 0x03;
    result |= inverted << (6 - index * 2);
  }
  return result;
}

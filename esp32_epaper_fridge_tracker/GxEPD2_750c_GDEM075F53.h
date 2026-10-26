#pragma once

#include <GxEPD2_4C.h>

// GDEM075F53 keeps the GDEM075F52 800x480 four-color native frame format,
// but replaces the JD79665AA controller with JD79665CA. GxEPD2 does not yet
// provide a dedicated class, so this adapter reuses its graphics surface while
// supplying the controller-specific initialization and sequential frame write.
class GxEPD2_750c_GDEM075F53 : public GxEPD2_750c_GDEM075F52
{
  public:
    // The vendor sample only demonstrates full-screen refresh. Hiding the F52
    // capability prevents GxEPD2_4C from issuing unverified 0x83 window writes.
    static const bool hasPartialUpdate = false;
    static const bool hasFastPartialUpdate = false;

    GxEPD2_750c_GDEM075F53(int16_t cs, int16_t dc, int16_t rst, int16_t busy);

    void writeNative(const uint8_t* data1, const uint8_t* data2,
                     int16_t x, int16_t y, int16_t w, int16_t h,
                     bool invert = false, bool mirrorY = false, bool pgm = false);
    void drawNative(const uint8_t* data1, const uint8_t* data2,
                    int16_t x, int16_t y, int16_t w, int16_t h,
                    bool invert = false, bool mirrorY = false, bool pgm = false);
    void refresh(bool partialUpdateMode = false) override;
    void refresh(int16_t x, int16_t y, int16_t w, int16_t h) override;
    void setPaged() override;

  private:
    void initDisplay();
    void waitForReady(const char* stage, uint16_t busyTimeMs);
    uint8_t invertNative(uint8_t data) const;

    bool pagedWrite_;
    uint16_t nextPagedRow_;
};

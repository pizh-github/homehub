#include <DNSServer.h>
#include <FFat.h>
#include <FS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SPI.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <esp_sleep.h>

#include "BoardProfile.h"
#include "Config.h"
#include "BatteryMessage.h"

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98 || FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
#include <GxEPD2_3C.h>
#else
#include <GxEPD2_4C.h>
#endif
#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F53
#include "GxEPD2_750c_GDEM075F53.h"
#endif
#include <Fonts/FreeMonoBold9pt7b.h>

#include "ProvisioningPage.h"

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
GxEPD2_3C<GxEPD2_420c_GDEY042Z98, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_420c_GDEY042Z98(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
GxEPD2_3C<GxEPD2_750c_GDEY075Z08, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_750c_GDEY075Z08(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM0397F81
GxEPD2_4C<GxEPD2_397c_GDEM0397F81, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_397c_GDEM0397F81(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F53
GxEPD2_4C<GxEPD2_750c_GDEM075F53, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_750c_GDEM075F53(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#else
GxEPD2_4C<GxEPD2_750c_GDEM075F52, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_750c_GDEM075F52(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#endif

struct DeviceSettings {
  String ssid;
  String password;
  String apiBaseUrl;
  String pairingCode;
  String serial;
  String deviceToken;
  String etag;
  String orientation;
  uint32_t checkIntervalMinutes;
  bool forceRefreshEveryCheck;
};

enum FrameResult {
  FRAME_UPDATED,
  FRAME_UNCHANGED,
  FRAME_FAILED
};

Preferences prefs;
WebServer portalServer(80);
DNSServer dnsServer;
DeviceSettings settings;
#if FRIDGE_PANEL_TYPE != FRIDGE_PANEL_GDEY042Z98 && FRIDGE_PANEL_TYPE != FRIDGE_PANEL_GDEY075Z08
#if FRIDGE_USE_CHUNKED_4C_DRAW
uint8_t imageChunk[DISPLAY_DRAW_CHUNK_BYTES];
#else
uint8_t* imageData = nullptr;
#endif
#endif
bool resumeAfterSave = false;
bool portalRoutesConfigured = false;
unsigned long resumeAt = 0;
bool g_timerWakeup = false; // true when this boot came from the deep-sleep timer
bool endpointIsLocal = false; // cached classification of settings.apiBaseUrl
uint8_t failCount = 0; // persisted consecutive-failure counter for the retry backoff
uint32_t g_nextCheckSeconds = 0; // one-shot wake time from the server's smart schedule
char errorTitle[32] = "Refresh failed";
char errorDetail[52] = "";
char errorHint[52] = "Power cycle for setup";

String defaultSerial();
bool loadSettings();
bool settingsReady();
void clearSettings();
bool forceSetupRequested();
bool wokeFromTimer();
uint32_t configuredPortalTimeoutMs();
bool isLocalApiUrl(const String& url);
uint32_t wifiConnectTimeoutMs();
uint32_t backoffCapSeconds();
uint32_t backoffSeconds(uint8_t count);
void recordFailure();
void clearFailures();
bool configureWifiRadio(bool modemSleep);
bool startProvisioningAccessPoint(const String& apName);
bool runProvisioningPortal(uint32_t timeoutMs = 0, bool showInstructions = true);
void stopProvisioningPortal();
void restartForConfigApply();
String provisioningPageHtml();
String scannedWifiOptionsHtml();
String htmlEscape(const String& text);
String jsonEscape(const String& text);
String joinApiUrl(const char* resource);
bool connectWiFi();
bool tryConnectUntil(uint8_t channel, unsigned long deadline);
bool beginHttp(HTTPClient& http, WiFiClient& client, WiFiClientSecure& secureClient, const String& url);
void readScheduleHeaders(HTTPClient& http);
bool registerDevice();
String jsonStringField(const String& body, const char* key);
FrameResult fetchNativeFrame();
bool storeDownloadedFrame(HTTPClient& http);
bool hasStoredImage();
bool drawStoredImage();
void releaseNetwork();
void logHeap(const char* label);
void drawStatusText(const char* line1, const char* line2, const char* line3, const char* line4 = "");
void setError(const char* title, const char* detail, const char* hint);
uint32_t contentFingerprint(const char* line1, const char* line2, const char* line3, const char* line4);
uint32_t storedScreenFingerprint();
void storeScreenFingerprint(uint32_t fingerprint);
void clearScreenFingerprint();
void drawErrorPage();
bool showStoredFrame();
void bumpRequestCount();
bool batterySamplingDue();
int readStoredBatteryPercent();
int batteryPercentForDraw();
void sleepForNextCheck(bool failed, uint64_t elapsedUs = 0);
int readBatteryPercent();
void drawBatteryOnPlane(uint8_t* plane, int percent, const String& orientation, bool isRedPlane);

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  g_timerWakeup = wokeFromTimer();
  // The boot delay is also the window for holding BOOT to clear the provisioning
  // settings (forceSetupRequested() runs after it), so only timer wakes may skip it.
  delay(g_timerWakeup ? TIMER_WAKE_SERIAL_DELAY_MS : SERIAL_BOOT_DELAY_MS);
  Serial.println();
  Serial.print("=== XianZhi Tie e-paper boot: ");
  Serial.print(FRIDGE_BOARD_NAME);
  Serial.print(" / ");
  Serial.print(PANEL_PROFILE);
  Serial.println(" ===");
  bool timerWakeup = g_timerWakeup;
  Serial.print("Wake source: ");
  Serial.println(timerWakeup ? "deep-sleep timer" : "power-on/reset");

  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  if (EPD_PWR >= 0) {
    pinMode(EPD_PWR, OUTPUT);
    digitalWrite(EPD_PWR, HIGH); // panel LDO on, same as epaper-test
    delay(100);
  }
  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, EPD_CS);
  // The panel is deliberately left asleep here: drawStatusText() and
  // drawStoredImage() each call display.init() right before they draw, so a wake
  // that ends in HTTP 304 (or in no drawing at all) never wakes the controller.
  logHeap("Heap after SPI begin (panel left sleeping)");

  if (!FFat.begin(true)) {
    setError("Storage failed", "Cannot mount FATFS", "");
    drawErrorPage();
    display.hibernate();
    sleepForNextCheck(true);
  }
  logHeap("Heap after FFat mount");

#if FRIDGE_PANEL_TYPE != FRIDGE_PANEL_GDEY042Z98 && FRIDGE_PANEL_TYPE != FRIDGE_PANEL_GDEY075Z08 && !FRIDGE_USE_CHUNKED_4C_DRAW
  imageData = static_cast<uint8_t*>(ps_malloc(DISPLAY_IMAGE_BYTES));
  if (!imageData) {
    imageData = static_cast<uint8_t*>(malloc(DISPLAY_IMAGE_BYTES));
  }
  if (!imageData) {
    setError("Memory failed", "Frame allocation", "Check PSRAM setting");
    drawErrorPage();
    display.hibernate();
    sleepForNextCheck(true);
  }
  logHeap("Heap after full-frame allocation");
#endif

  loadSettings();
  bool provisioningHandled = false;
  if (forceSetupRequested()) {
    clearSettings();
    loadSettings();
    runProvisioningPortal();
    provisioningHandled = true;
  }
  if (!settingsReady()) {
    runProvisioningPortal();
    provisioningHandled = true;
  }
  bool offerPowerOnPortal = !provisioningHandled && !timerWakeup;

  if (!connectWiFi()) {
    bool configSaved = false;
    uint64_t portalElapsedUs = 0;
    if (!timerWakeup) {
      unsigned long portalStartedAt = millis();
      configSaved = runProvisioningPortal(configuredPortalTimeoutMs());
      portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
    }
    releaseNetwork();
    if (configSaved) {
      display.hibernate();
      restartForConfigApply();
    }
    drawErrorPage();
    display.hibernate();
    sleepForNextCheck(true, portalElapsedUs);
  }

  if (settings.deviceToken.isEmpty() && !registerDevice()) {
    releaseNetwork();
    bool storedImageAvailable = hasStoredImage();
    uint64_t portalElapsedUs = 0;
    if (offerPowerOnPortal) {
      unsigned long portalStartedAt = millis();
      bool configSaved = runProvisioningPortal(configuredPortalTimeoutMs(), !storedImageAvailable);
      portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
      if (configSaved) {
        restartForConfigApply();
      }
    }
    if (!storedImageAvailable) {
      drawErrorPage();
    }
    display.hibernate();
    sleepForNextCheck(true, portalElapsedUs);
  }

  FrameResult result = fetchNativeFrame();
  releaseNetwork();
  if (result == FRAME_UPDATED) {
    showStoredFrame();
  } else if (result == FRAME_UNCHANGED && settings.forceRefreshEveryCheck) {
    Serial.println("Debug refresh enabled; redrawing the cached frame after HTTP 304.");
    showStoredFrame();
  } else if (result == FRAME_FAILED && !hasStoredImage()) {
    drawErrorPage();
  } else {
    Serial.println("Retaining the current e-paper image.");
  }

  display.hibernate();
  uint64_t portalElapsedUs = 0;
  if (offerPowerOnPortal) {
    uint32_t portalTimeoutMs = configuredPortalTimeoutMs();
    Serial.print("Opening the post-refresh configuration window for seconds: ");
    Serial.println(portalTimeoutMs / 1000UL);
    unsigned long portalStartedAt = millis();
    if (runProvisioningPortal(portalTimeoutMs, false)) {
      restartForConfigApply();
    }
    portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
  }
  sleepForNextCheck(false, portalElapsedUs);
}

void loop() {
}

String defaultSerial() {
  uint64_t chip = ESP.getEfuseMac();
  char serial[32];
  snprintf(serial, sizeof(serial), "fridge-%04X%08X",
           static_cast<uint16_t>(chip >> 32), static_cast<uint32_t>(chip));
  return String(serial);
}

bool loadSettings() {
  prefs.begin("fridge", true);
  settings.ssid = prefs.getString("ssid", "");
  settings.password = prefs.getString("pass", "");
  settings.apiBaseUrl = prefs.getString("api", DEFAULT_API_BASE_URL);
  settings.pairingCode = prefs.getString("pair", "");
  settings.serial = prefs.getString("serial", defaultSerial());
  settings.deviceToken = prefs.getString("token", "");
  settings.etag = prefs.getString("etag", "");
  settings.orientation = prefs.getString("orient", "portrait");
  settings.checkIntervalMinutes = prefs.getUInt("interval", DEFAULT_CHECK_INTERVAL_MINUTES);
  settings.forceRefreshEveryCheck = prefs.getBool("force", false);
  failCount = prefs.getUChar(FAIL_COUNT_KEY, 0);
  prefs.end();
  if (settings.checkIntervalMinutes < MIN_CHECK_INTERVAL_MINUTES ||
      settings.checkIntervalMinutes > MAX_CHECK_INTERVAL_MINUTES) {
    settings.checkIntervalMinutes = DEFAULT_CHECK_INTERVAL_MINUTES;
  }
  if (settings.orientation != "portrait" && settings.orientation != "landscape") {
    settings.orientation = "portrait";
  }
  endpointIsLocal = isLocalApiUrl(settings.apiBaseUrl);
  return settingsReady();
}

bool settingsReady() {
  if (settings.ssid.isEmpty() || settings.apiBaseUrl.isEmpty()) {
    return false;
  }
  if (!settings.deviceToken.isEmpty()) {
    return true;
  }
  return !settings.pairingCode.isEmpty();
}

void clearSettings() {
  prefs.begin("fridge", false);
  prefs.clear();
  prefs.end();
  FFat.remove(IMAGE_PATH);
  FFat.remove(TEMP_IMAGE_PATH);
  FFat.remove(BACKUP_IMAGE_PATH);
  Serial.println("Provisioning settings cleared.");
}

bool forceSetupRequested() {
  if (digitalRead(CONFIG_BUTTON_PIN) != LOW) {
    return false;
  }
  delay(80);
  return digitalRead(CONFIG_BUTTON_PIN) == LOW;
}

bool wokeFromTimer() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
}

uint32_t configuredPortalTimeoutMs() {
  uint32_t checkIntervalMs = settings.checkIntervalMinutes * 60UL * 1000UL;
  return checkIntervalMs < MAX_POWER_ON_PORTAL_TIMEOUT_MS
    ? checkIntervalMs
    : MAX_POWER_ON_PORTAL_TIMEOUT_MS;
}

// Classify the configured API base URL without any network probing: plain HTTP,
// private/link-local IPv4 literals and mDNS-style host names are treated as LAN.
bool isLocalApiUrl(const String& url) {
  int schemeEnd = url.indexOf("://");
  String scheme = schemeEnd > 0 ? url.substring(0, schemeEnd) : String("http");
  scheme.toLowerCase();
  int hostStart = schemeEnd > 0 ? schemeEnd + 3 : 0;
  int hostEnd = url.indexOf('/', hostStart);
  if (hostEnd < 0) {
    hostEnd = url.length();
  }
  String authority = url.substring(hostStart, hostEnd);
  int at = authority.lastIndexOf('@');
  if (at >= 0) {
    authority = authority.substring(at + 1);
  }
  int colon = authority.indexOf(':');
  String host = colon >= 0 ? authority.substring(0, colon) : authority;
  host.toLowerCase();

  if (scheme == "http") {
    return true; // HTTPS to a public host is the only case that pays for TLS
  }
  if (host == "localhost") {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")) {
    return true;
  }
  int a = 0, b = 0, c = 0, d = 0;
  if (sscanf(host.c_str(), "%d.%d.%d.%d", &a, &b, &c, &d) == 4) {
    if (a == 10 || a == 127) return true;
    if (a == 192 && b == 168) return true;
    if (a == 172 && b >= 16 && b <= 31) return true;
    if (a == 169 && b == 254) return true;
  }
  return false;
}

uint32_t wifiConnectTimeoutMs() {
  // Stay conservative until registration succeeded: a slow router or a first DNS
  // lookup must never be mistaken for a setup failure.
  if (settings.deviceToken.isEmpty()) {
    return WIFI_TIMEOUT_MS;
  }
  return endpointIsLocal ? WIFI_TIMEOUT_MS_LOCAL : WIFI_TIMEOUT_MS_PUBLIC;
}

uint32_t backoffCapSeconds() {
  // The configured interval is the floor for every retry path: retries grow until
  // they reach it and then keep using it.
  uint32_t configured = settings.checkIntervalMinutes * 60UL;
  return configured > BACKOFF_MIN_SECONDS ? configured : BACKOFF_MIN_SECONDS;
}

uint32_t backoffSeconds(uint8_t count) {
  uint32_t cap = backoffCapSeconds();
  uint32_t seconds = BACKOFF_MIN_SECONDS;
  for (uint8_t step = 1; step < count && seconds < cap; step++) {
    seconds = seconds > cap / 2 ? cap : seconds * 2;
  }
  return seconds > cap ? cap : seconds;
}

void recordFailure() {
  if (failCount < 255) {
    failCount += 1;
  }
  prefs.begin("fridge", false);
  prefs.putUChar(FAIL_COUNT_KEY, failCount);
  prefs.end();
}

void clearFailures() {
  if (failCount == 0) {
    return;
  }
  failCount = 0;
  prefs.begin("fridge", false);
  prefs.putUChar(FAIL_COUNT_KEY, 0);
  prefs.end();
}

bool configureWifiRadio(bool modemSleep) {
  // Modem sleep is only enabled once a connect attempt is clearly going to take
  // a while: there is no data to move during that wait, so letting the radio nap
  // between beacons is free. Downloads keep the radio fully awake.
  WiFi.setSleep(modemSleep);
#if FRIDGE_LIMIT_WIFI_TX_POWER
  bool powerSet = WiFi.setTxPower(WIFI_POWER_8_5dBm);
  Serial.print("Wi-Fi reduced TX power: ");
  Serial.println(powerSet ? "set" : "failed");
  return powerSet;
#else
  Serial.println("Wi-Fi TX power: board default");
  return true;
#endif
}

bool startProvisioningAccessPoint(const String& apName) {
  for (uint8_t attempt = 1; attempt <= 2; attempt += 1) {
    WiFi.disconnect(true, false);
    delay(WIFI_MODE_TRANSITION_DELAY_MS);

    // AP+STA keeps the setup hotspot online while the portal scans nearby SSIDs.
    bool modeReady = WiFi.mode(WIFI_AP_STA);
    bool powerSet = configureWifiRadio(false); // AP mode always keeps the radio awake
    delay(WIFI_MODE_TRANSITION_DELAY_MS);

    bool apStarted = modeReady &&
      WiFi.softAP(apName.c_str(), nullptr, PROVISIONING_AP_CHANNEL,
                  false, PROVISIONING_AP_MAX_CLIENTS);
    Serial.print("Provisioning AP attempt ");
    Serial.print(attempt);
    Serial.print(": mode=");
    Serial.print(modeReady ? "ready" : "failed");
    Serial.print(", power=");
    Serial.print(powerSet ? "set" : "failed");
    Serial.print(", AP=");
    Serial.println(apStarted ? "started" : "failed");
    if (apStarted) {
      return true;
    }

    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(WIFI_AP_RETRY_DELAY_MS);
  }
  return false;
}

bool runProvisioningPortal(uint32_t timeoutMs, bool showInstructions) {
  String apName = PROVISIONING_AP_PREFIX + settings.serial.substring(max(0, int(settings.serial.length()) - 6));
  resumeAfterSave = false;

  if (showInstructions) {
    drawStatusText("1 Connect phone Wi-Fi", apName.c_str(), "2 Open 192.168.4.1", "Follow setup page");
  }
  display.hibernate();

  if (!startProvisioningAccessPoint(apName)) {
    Serial.println("Provisioning AP failed after 2 attempts.");
    if (timeoutMs == 0) {
      drawStatusText("Wi-Fi AP failed", "Power cycle device", "Check serial log");
      display.hibernate();
      sleepForNextCheck(true);
    }
    return false;
  }

  IPAddress portalIp = WiFi.softAPIP();
  unsigned long startedAt = millis();
  Serial.print("Provisioning AP: ");
  Serial.println(apName);
  Serial.print("Portal URL: http://");
  Serial.println(portalIp);

  dnsServer.start(53, "*", portalIp);
  if (!portalRoutesConfigured) {
    portalServer.on("/", HTTP_GET, []() {
      portalServer.send(200, "text/html; charset=utf-8", provisioningPageHtml());
    });
    portalServer.on("/save", HTTP_POST, []() {
      String newSsid = portalServer.arg("ssid");
      String newApi = portalServer.arg("api");
      String newPassword = portalServer.arg("password");
      String newPairing = portalServer.arg("pairing");
      String newToken = portalServer.arg("token");
      String newOrientation = portalServer.arg("orientation");
      uint32_t newIntervalMinutes = portalServer.arg("interval").toInt();
      bool newForceRefreshEveryCheck = portalServer.hasArg("force_refresh");
      newSsid.trim();
      newApi.trim();
      newPairing.trim();
      newPairing.replace(" ", "");
      newPairing.replace("-", "");
      newPairing.toUpperCase();
      if (newOrientation != "portrait" && newOrientation != "landscape") {
        portalServer.send(400, "text/plain; charset=utf-8", "Display orientation is invalid.");
        return;
      }

      bool identityChanged = newApi != settings.apiBaseUrl || newPairing != settings.pairingCode;
      bool keepsRegisteredToken = !settings.deviceToken.isEmpty() && !identityChanged && newToken.isEmpty();
      bool submitsToken = !newToken.isEmpty();
      if (newSsid.isEmpty() || newApi.isEmpty() ||
          (!keepsRegisteredToken && !submitsToken && newPairing.isEmpty())) {
        portalServer.send(400, "text/plain; charset=utf-8",
          "SSID and server URL are required. Provide a device token or a pairing code from the H5 device page.");
        return;
      }
      if (newIntervalMinutes < MIN_CHECK_INTERVAL_MINUTES ||
          newIntervalMinutes > MAX_CHECK_INTERVAL_MINUTES) {
        portalServer.send(400, "text/plain; charset=utf-8",
          "Check interval must be between 5 and 1440 minutes.");
        return;
      }

      prefs.begin("fridge", false);
      prefs.putString("ssid", newSsid);
      if (!newPassword.isEmpty()) {
        prefs.putString("pass", newPassword);
      }
      prefs.putString("api", newApi);
      prefs.putString("pair", newPairing);
      prefs.putUInt("interval", newIntervalMinutes);
      prefs.putBool("force", newForceRefreshEveryCheck);
      prefs.putString("orient", newOrientation);
      prefs.remove("prov");
      prefs.putString("serial", settings.serial);
      if (!newToken.isEmpty()) {
        prefs.putString("token", newToken);
        prefs.remove("etag");
      } else if (identityChanged) {
        prefs.remove("token");
        prefs.remove("etag");
      }
      prefs.end();
      // A new configuration invalidates the retry backoff, the cached screen
      // fingerprint and the remembered Wi-Fi channel (the SSID may have changed).
      clearFailures();
      clearScreenFingerprint();
      prefs.begin("fridge", false);
      prefs.remove(WIFI_CHANNEL_KEY);
      prefs.end();
      if (submitsToken || identityChanged) {
        FFat.remove(IMAGE_PATH);
        FFat.remove(TEMP_IMAGE_PATH);
        FFat.remove(BACKUP_IMAGE_PATH);
      }

      portalServer.send_P(200, "text/html; charset=utf-8", PROVISIONING_SAVED_PAGE);
      resumeAfterSave = true;
      resumeAt = millis() + 1000;
    });
    portalServer.onNotFound([]() {
      portalServer.sendHeader("Location", "/", true);
      portalServer.send(302, "text/plain", "");
    });
    portalRoutesConfigured = true;
  }
  portalServer.begin();

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (resumeAfterSave && millis() >= resumeAt) {
      stopProvisioningPortal();
      loadSettings();
      Serial.println("Provisioning saved; continuing with the new settings.");
      return true;
    }
    if (timeoutMs > 0 && millis() - startedAt >= timeoutMs) {
      Serial.println("Provisioning portal timed out.");
      stopProvisioningPortal();
      return false;
    }
    delay(5);
  }
}

void stopProvisioningPortal() {
  portalServer.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
}

void restartForConfigApply() {
  Serial.println("Restarting in 1 second to apply the saved configuration.");
  Serial.flush();
  delay(SERIAL_SLEEP_DELAY_MS);
  esp_sleep_enable_timer_wakeup(CONFIG_APPLY_RESTART_DELAY_US);
  esp_deep_sleep_start();
}

String provisioningPageHtml() {
  String page = FPSTR(PROVISIONING_PAGE);
  page.replace("%SSID%", htmlEscape(settings.ssid));
  page.replace("%SSID_OPTIONS%", scannedWifiOptionsHtml());
  page.replace("%API%", htmlEscape(settings.apiBaseUrl));
  page.replace("%PAIRING%", htmlEscape(settings.pairingCode));
  page.replace("%INTERVAL%", String(settings.checkIntervalMinutes));
  page.replace("%FORCE_REFRESH_CHECKED%", settings.forceRefreshEveryCheck ? " checked" : "");
  page.replace("%PORTRAIT_SELECTED%", settings.orientation == "portrait" ? " selected" : "");
  page.replace("%LANDSCAPE_SELECTED%", settings.orientation == "landscape" ? " selected" : "");
  page.replace("%PANEL%", PANEL_PROFILE);
  page.replace("%SERIAL%", htmlEscape(settings.serial));
  return page;
}

String scannedWifiOptionsHtml() {
  String options = "<option value=\"\">选择附近 Wi-Fi 或手动输入</option>";
  int count = WiFi.scanNetworks();
  if (count <= 0) {
    return options;
  }
  for (int index = 0; index < count; index += 1) {
    String ssid = WiFi.SSID(index);
    ssid.trim();
    if (ssid.isEmpty()) {
      continue;
    }
    String escaped = htmlEscape(ssid);
    options += "<option value=\"" + escaped + "\"";
    if (ssid == settings.ssid) {
      options += " selected";
    }
    options += ">" + escaped + " (" + String(WiFi.RSSI(index)) + " dBm)</option>";
  }
  WiFi.scanDelete();
  return options;
}

String htmlEscape(const String& text) {
  String escaped = text;
  escaped.replace("&", "&amp;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  escaped.replace("\"", "&quot;");
  return escaped;
}

String jsonEscape(const String& text) {
  String escaped = text;
  escaped.replace("\\", "\\\\");
  escaped.replace("\"", "\\\"");
  escaped.replace("\r", "\\r");
  escaped.replace("\n", "\\n");
  return escaped;
}

String joinApiUrl(const char* resource) {
  String url = settings.apiBaseUrl;
  while (url.endsWith("/")) {
    url.remove(url.length() - 1);
  }
  url += resource;
  return url;
}

bool tryConnectUntil(uint8_t channel, unsigned long deadline) {
  WiFi.setSleep(false); // every attempt starts at full speed
  Serial.print("Connecting Wi-Fi: ");
  Serial.print(settings.ssid);
  if (channel > 0) {
    // Remembering the channel lets the radio skip the 1-13 channel scan. The
    // BSSID is deliberately not cached so mesh/multi-AP setups still connect.
    Serial.print(" (cached channel ");
    Serial.print(channel);
    Serial.print(")");
    WiFi.begin(settings.ssid.c_str(), settings.password.c_str(), channel, nullptr);
  } else {
    Serial.print(" (full channel scan)");
    WiFi.begin(settings.ssid.c_str(), settings.password.c_str());
  }
  Serial.print(" ");
  unsigned long startedAt = millis();
  bool modemSleep = false;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    wl_status_t status = WiFi.status();
    if (status == WL_NO_SSID_AVAIL || status == WL_CONNECT_FAILED) {
      // A definitive failure (wrong channel / refused): stop waiting and let the
      // caller fall back to a full scan instead of burning the whole budget.
      break;
    }
    if (!modemSleep && millis() - startedAt >= WIFI_MODEM_SLEEP_AFTER_MS) {
      WiFi.setSleep(true);
      modemSleep = true;
      Serial.print("[modem sleep]");
    }
    delay(100);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

bool connectWiFi() {
  logHeap("Heap before Wi-Fi");
  bool modeReady = WiFi.mode(WIFI_STA);
  delay(WIFI_MODE_TRANSITION_DELAY_MS);
  bool powerSet = configureWifiRadio(false); // full speed while associating
  uint32_t timeoutMs = wifiConnectTimeoutMs();
  Serial.print("Wi-Fi station mode: ");
  Serial.print(modeReady ? "ready" : "failed");
  Serial.print(", power: ");
  Serial.print(powerSet ? "set" : "failed");
  Serial.print(", endpoint: ");
  Serial.print(endpointIsLocal ? "local" : "public");
  Serial.print(", timeout ms: ");
  Serial.println(timeoutMs);
  if (!modeReady) {
    setError("Wi-Fi failed", "Cannot start radio", "Power cycle for setup");
    return false;
  }

  prefs.begin("fridge", true);
  uint8_t cachedChannel = prefs.getUChar(WIFI_CHANNEL_KEY, 0);
  prefs.end();

  bool connected = false;
  if (cachedChannel > 0) {
    connected = tryConnectUntil(cachedChannel, millis() + WIFI_FAST_CONNECT_TIMEOUT_MS);
    if (!connected) {
      // The AP may have moved to another channel, or the device was moved.
      Serial.println("Cached channel failed; retrying with a full scan.");
      WiFi.disconnect();
      delay(WIFI_MODE_TRANSITION_DELAY_MS);
    }
  }
  if (!connected) {
    // The fallback gets a fresh full budget: it is rare, and it must succeed.
    connected = tryConnectUntil(0, millis() + timeoutMs);
  }
  if (!connected) {
    setError("Wi-Fi failed", "Cannot connect", "Power cycle for setup");
    return false;
  }

  // Restore full-speed radio for the download phase.
  WiFi.setSleep(false);
  uint8_t usedChannel = uint8_t(WiFi.channel());
  if (usedChannel > 0 && usedChannel != cachedChannel) {
    prefs.begin("fridge", false);
    prefs.putUChar(WIFI_CHANNEL_KEY, usedChannel);
    prefs.end();
  }
  Serial.print("Wi-Fi IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("Wi-Fi channel cached: ");
  Serial.println(usedChannel);
  logHeap("Heap after Wi-Fi");
  return true;
}

bool beginHttp(HTTPClient& http, WiFiClient& client, WiFiClientSecure& secureClient, const String& url) {
  if (url.startsWith("https://")) {
    if (ALLOW_INSECURE_HTTPS) {
      secureClient.setInsecure();
    }
    return http.begin(secureClient, url);
  }
  return http.begin(client, url);
}

bool registerDevice() {
  logHeap("Heap before register");
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = joinApiUrl("/api/device/register");
  if (!beginHttp(http, client, secureClient, url)) {
    setError("Register failed", "HTTP setup error", "Check server URL");
    return false;
  }

  String payload = "{\"serial\":\"" + jsonEscape(settings.serial) +
    "\",\"pairingCode\":\"" + jsonEscape(settings.pairingCode) +
    "\",\"panel\":\"" + String(PANEL_PROFILE) + "\"}";
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  int status = http.sendRequest("POST", payload);
  String body = http.getString();
  http.end();

  if (status != HTTP_CODE_CREATED) {
    char detail[32];
    snprintf(detail, sizeof(detail), "HTTP %d", status);
    setError("Register failed", detail, "Check setup values");
    return false;
  }

  String token = jsonStringField(body, "deviceToken");
  if (token.isEmpty()) {
    setError("Register failed", "Missing token", "Check server");
    return false;
  }

  settings.deviceToken = token;
  settings.pairingCode = "";
  settings.etag = "";
  prefs.begin("fridge", false);
  prefs.putString("token", settings.deviceToken);
  prefs.remove("pair");
  prefs.remove("etag");
  prefs.end();
  Serial.println("Device registration completed.");
  logHeap("Heap after register");
  return true;
}

String jsonStringField(const String& body, const char* key) {
  String prefix = "\"" + String(key) + "\":\"";
  int start = body.indexOf(prefix);
  if (start < 0) {
    return "";
  }
  start += prefix.length();
  int end = body.indexOf('"', start);
  if (end < 0) {
    return "";
  }
  return body.substring(start, end);
}

// Smart schedule: the server may answer with a one-shot wake time and/or a new
// hardware interval. Both are optional; missing headers keep the current behaviour.
void readScheduleHeaders(HTTPClient& http) {
  g_nextCheckSeconds = 0;
  String hintHeader = http.header("X-Next-Check-Seconds");
  String intervalHeader = http.header("X-Check-Interval-Seconds");

  uint32_t hint = uint32_t(hintHeader.toInt());
  uint32_t intervalSeconds = uint32_t(intervalHeader.toInt());

  if (intervalSeconds >= MIN_CHECK_INTERVAL_MINUTES * 60UL &&
      intervalSeconds <= MAX_CHECK_INTERVAL_MINUTES * 60UL) {
    uint32_t minutes = intervalSeconds / 60UL;
    if (minutes != settings.checkIntervalMinutes) {
      settings.checkIntervalMinutes = minutes;
      prefs.begin("fridge", false);
      prefs.putUInt("interval", minutes);
      prefs.end();
      Serial.print("Interval updated by server, minutes: ");
      Serial.println(minutes);
    }
  }

  if (hint > 0) {
    // No policy limits here: the device sleeps exactly as long as the server asks.
    // The sanity bound only rejects absurd values from a parsing failure.
    if (hint <= SMART_HINT_SANITY_MAX_SECONDS) {
      g_nextCheckSeconds = hint;
    } else {
      Serial.print("Ignoring implausible schedule hint seconds: ");
      Serial.println(hint);
    }
  }

  if (!hintHeader.isEmpty() || !intervalHeader.isEmpty()) {
    Serial.print("Schedule headers: hint=");
    Serial.print(hint);
    Serial.print(", interval=");
    Serial.println(intervalSeconds);
  }
}

FrameResult fetchNativeFrame() {
  bumpRequestCount();
  logHeap("Heap before frame request");
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = joinApiUrl("/api/device/frame.bin?panel=");
  url += PANEL_PROFILE;
  url += "&orientation=";
  url += settings.orientation;
  // Report the current hardware interval so the server can show it and keep its copy
  // in sync (a change made on the device page wins over the stored value).
  url += "&interval=";
  url += String(settings.checkIntervalMinutes);
  Serial.print("Downloading frame: ");
  Serial.println(url);

  if (!beginHttp(http, client, secureClient, url)) {
    setError("Request failed", "HTTP setup error", "Check server URL");
    return FRAME_FAILED;
  }

  // Every custom header must be collected, otherwise http.header() silently returns "".
  const char* keys[] = { "ETag", "X-Next-Check-Seconds", "X-Check-Interval-Seconds" };
  http.collectHeaders(keys, 3);
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Authorization", "Bearer " + settings.deviceToken);
  if (!settings.etag.isEmpty() && hasStoredImage()) {
    http.addHeader("If-None-Match", settings.etag);
  } else if (!settings.etag.isEmpty()) {
    Serial.println("Ignoring saved ETag because no valid local frame exists.");
  }

  int status = http.GET();
  if (status == HTTP_CODE_NOT_MODIFIED) {
    Serial.println("Frame is unchanged.");
    readScheduleHeaders(http); // the 304 response carries the schedule too
    http.end();
    return FRAME_UNCHANGED;
  }
  if (status != HTTP_CODE_OK) {
    char detail[32];
    snprintf(detail, sizeof(detail), "HTTP %d", status);
    setError("Request failed", detail, "Check server");
    http.end();
    return FRAME_FAILED;
  }

  String newEtag = http.header("ETag");
  readScheduleHeaders(http);
  if (!storeDownloadedFrame(http)) {
    http.end();
    return FRAME_FAILED;
  }
  http.end();
  if (!newEtag.isEmpty()) {
    settings.etag = newEtag;
    prefs.begin("fridge", false);
    prefs.putString("etag", settings.etag);
    prefs.end();
  }
  logHeap("Heap after frame request");
  return FRAME_UPDATED;
}

bool storeDownloadedFrame(HTTPClient& http) {
  int contentLength = http.getSize();
  if (contentLength >= 0 && contentLength != int(DISPLAY_IMAGE_BYTES)) {
    setError("Image failed", "Wrong frame size", "Check panel");
    return false;
  }

  FFat.remove(TEMP_IMAGE_PATH);
  File temporary = FFat.open(TEMP_IMAGE_PATH, "w");
  if (!temporary) {
    setError("Storage failed", "Cannot write frame", "Check FATFS");
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buffer[1024];
  size_t total = 0;
  unsigned long lastDataAt = millis();
  while (http.connected()) {
    size_t available = stream->available();
    if (available == 0) {
      if (contentLength >= 0 && total >= size_t(contentLength)) {
        break;
      }
      if (millis() - lastDataAt > DOWNLOAD_TIMEOUT_MS) {
        temporary.close();
        FFat.remove(TEMP_IMAGE_PATH);
        setError("Request failed", "Download timeout", "Try again later");
        return false;
      }
      delay(10);
      continue;
    }
    size_t toRead = min(available, sizeof(buffer));
    int count = stream->readBytes(buffer, toRead);
    if (count <= 0) {
      break;
    }
    lastDataAt = millis();
    total += count;
    if (total > DISPLAY_IMAGE_BYTES || temporary.write(buffer, count) != size_t(count)) {
      temporary.close();
      FFat.remove(TEMP_IMAGE_PATH);
      setError("Storage failed", "Frame write error", "Check FATFS");
      return false;
    }
  }
  temporary.close();

  if (total != DISPLAY_IMAGE_BYTES) {
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Request failed", "Incomplete frame", "Try again later");
    return false;
  }

  bool hadImage = hasStoredImage();
  FFat.remove(BACKUP_IMAGE_PATH);
  if (hadImage && !FFat.rename(IMAGE_PATH, BACKUP_IMAGE_PATH)) {
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Storage failed", "Cannot backup frame", "Check FATFS");
    return false;
  }
  if (!hadImage) {
    FFat.remove(IMAGE_PATH);
  }
  if (!FFat.rename(TEMP_IMAGE_PATH, IMAGE_PATH)) {
    if (hadImage) {
      FFat.rename(BACKUP_IMAGE_PATH, IMAGE_PATH);
    }
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Storage failed", "Cannot store frame", "Check FATFS");
    return false;
  }
  FFat.remove(BACKUP_IMAGE_PATH);
  Serial.print("Stored frame bytes: ");
  Serial.println(total);
  return true;
}

bool hasStoredImage() {
  File file = FFat.open(IMAGE_PATH, "r");
  if (!file) {
    return false;
  }
  bool valid = file.size() == DISPLAY_IMAGE_BYTES;
  file.close();
  return valid;
}

static const uint8_t BAT_FONT_5x7[10][7] = {
  {0x0E,0x11,0x13,0x15,0x19,0x11,0x0E}, // 0
  {0x04,0x0C,0x04,0x04,0x04,0x04,0x0E}, // 1
  {0x0E,0x11,0x01,0x02,0x04,0x08,0x1F}, // 2
  {0x1F,0x02,0x04,0x02,0x01,0x11,0x0E}, // 3
  {0x02,0x06,0x0A,0x12,0x1F,0x02,0x02}, // 4
  {0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E}, // 5
  {0x06,0x08,0x10,0x1E,0x11,0x11,0x0E}, // 6
  {0x1F,0x01,0x02,0x04,0x08,0x08,0x08}, // 7
  {0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E}, // 8
  {0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C}  // 9
};

static void batterySetVisualPixel(uint8_t* plane, int16_t x, int16_t y,
                                  const String& orientation, bool white) {
  int16_t visW = (orientation == "portrait") ? int16_t(DISPLAY_HEIGHT) : int16_t(DISPLAY_WIDTH);
  int16_t visH = (orientation == "portrait") ? int16_t(DISPLAY_WIDTH) : int16_t(DISPLAY_HEIGHT);
  if (x < 0 || x >= visW || y < 0 || y >= visH) return;
  int16_t nativeX, nativeY;
  if (orientation == "portrait") {
    nativeX = int16_t(DISPLAY_WIDTH) - 1 - y;
    nativeY = x;
  } else {
    nativeX = x;
    nativeY = y;
  }
  if (nativeX < 0 || nativeX >= int16_t(DISPLAY_WIDTH) ||
      nativeY < 0 || nativeY >= int16_t(DISPLAY_HEIGHT)) return;
  uint8_t mask = 0x80 >> (nativeX & 7);
  size_t index = size_t(nativeY) * DISPLAY_BYTES_PER_ROW + (nativeX >> 3);
  if (white) plane[index] |= mask;
  else plane[index] &= ~mask;
}

static void batteryFillRect(uint8_t* plane, int16_t x, int16_t y, int16_t w, int16_t h,
                            const String& orientation, bool white) {
  for (int16_t row = 0; row < h; row++) {
    for (int16_t col = 0; col < w; col++) {
      batterySetVisualPixel(plane, x + col, y + row, orientation, white);
    }
  }
}

static void batteryDrawOutline(uint8_t* plane, int16_t x, int16_t y, int16_t w, int16_t h,
                               const String& orientation) {
  batteryFillRect(plane, x, y, w, 1, orientation, false);
  batteryFillRect(plane, x, y + h - 1, w, 1, orientation, false);
  batteryFillRect(plane, x, y, 1, h, orientation, false);
  batteryFillRect(plane, x + w - 1, y, 1, h, orientation, false);
}

static void batteryDrawChar(uint8_t* plane, char c, int16_t x, int16_t y, int scale,
                            const String& orientation) {
  if (c < '0' || c > '9') return;
  const uint8_t* glyph = BAT_FONT_5x7[c - '0'];
  for (int row = 0; row < 7; row++) {
    for (int col = 0; col < 5; col++) {
      if (glyph[row] & (0x10 >> col)) {
        for (int sy = 0; sy < scale; sy++) {
          for (int sx = 0; sx < scale; sx++) {
            batterySetVisualPixel(plane, x + col * scale + sx, y + row * scale + sy,
                                  orientation, false);
          }
        }
      }
    }
  }
}

int readBatteryPercent() {
  if (BAT_ADC_PIN < 0 || BAT_ADC_CONTROL_PIN < 0) return -1;

  pinMode(BAT_ADC_CONTROL_PIN, OUTPUT);
  digitalWrite(BAT_ADC_CONTROL_PIN, LOW); // isolate ADC noise per board manual
  delay(20);

  analogSetPinAttenuation(BAT_ADC_PIN, ADC_11db);
  uint32_t sum = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    sum += analogReadMilliVolts(BAT_ADC_PIN);
    delay(10);
  }
  int adcMv = int(sum / samples);

  pinMode(BAT_ADC_CONTROL_PIN, INPUT_PULLUP); // restore IO8 to normal GPIO

  int batMv = adcMv * 2; // 10k/10k divider
  Serial.print("Battery ADC: ");
  Serial.print(adcMv);
  Serial.print(" mV, Vbat: ");
  Serial.print(batMv);
  Serial.println(" mV");
  if (batMv < 2500) return -1; // no battery or deeply discharged

  static const int voltages[] = {4200, 4100, 4000, 3900, 3800, 3700, 3600, 3500, 3400, 3300, 3200, 3000};
  static const int percents[] = {100, 92, 84, 76, 68, 58, 48, 38, 28, 18, 10, 0};
  for (size_t i = 0; i < sizeof(voltages) / sizeof(voltages[0]); i++) {
    if (batMv >= voltages[i]) return percents[i];
  }
  return 0;
}

// Every wake issues exactly one frame request, so the request counter is a stable
// clock for the battery sample cadence (~1 day at the 50-request threshold).
void bumpRequestCount() {
  prefs.begin("fridge", false);
  uint16_t count = prefs.getUShort(REQUEST_COUNT_KEY, 0);
  prefs.putUShort(REQUEST_COUNT_KEY, uint16_t(count + 1));
  prefs.end();
}

bool batterySamplingDue() {
  prefs.begin("fridge", true);
  uint8_t stored = prefs.getUChar(BATTERY_PERCENT_KEY, BATTERY_PERCENT_UNKNOWN);
  uint16_t requests = prefs.getUShort(REQUEST_COUNT_KEY, 0);
  uint16_t sampledAt = prefs.getUShort(BATTERY_SAMPLED_AT_KEY, 0);
  prefs.end();
  if (stored == BATTERY_PERCENT_UNKNOWN) {
    return true; // nothing usable yet
  }
  if (!g_timerWakeup) {
    return true; // a manual power cycle always refreshes the reading
  }
  return uint16_t(requests - sampledAt) >= BATTERY_SAMPLE_REQUESTS;
}

int readStoredBatteryPercent() {
  prefs.begin("fridge", true);
  uint8_t stored = prefs.getUChar(BATTERY_PERCENT_KEY, BATTERY_PERCENT_UNKNOWN);
  prefs.end();
  return stored == BATTERY_PERCENT_UNKNOWN ? -1 : int(stored);
}

int batteryPercentForDraw() {
  if (!batterySamplingDue()) {
    int stored = readStoredBatteryPercent();
    Serial.print("Battery percent (cached): ");
    Serial.println(stored);
    return stored;
  }
  int percent = readBatteryPercent();
  prefs.begin("fridge", false);
  prefs.putUChar(BATTERY_PERCENT_KEY, uint8_t(percent < 0 ? BATTERY_PERCENT_UNKNOWN : percent));
  prefs.putUShort(BATTERY_SAMPLED_AT_KEY, prefs.getUShort(REQUEST_COUNT_KEY, 0));
  prefs.end();
  return percent;
}

static void batteryDrawSprite(uint8_t* plane, int16_t x, int16_t y,
                              const uint8_t* sprite, uint16_t w, uint16_t h,
                              const String& orientation) {
  uint16_t bytesPerRow = (w + 7) / 8;
  for (uint16_t row = 0; row < h; row++) {
    for (uint16_t col = 0; col < w; col++) {
      uint8_t byte = sprite[size_t(row) * bytesPerRow + (col >> 3)];
      if (byte & (0x80 >> (col & 7))) {
        batterySetVisualPixel(plane, x + col, y + row, orientation, false);
      }
    }
  }
}

void drawBatteryOnPlane(uint8_t* plane, int percent, const String& orientation, bool isRedPlane) {
  int16_t visW = (orientation == "portrait") ? int16_t(DISPLAY_HEIGHT) : int16_t(DISPLAY_WIDTH);
  int16_t visH = (orientation == "portrait") ? int16_t(DISPLAY_WIDTH) : int16_t(DISPLAY_HEIGHT);
  const int16_t boxW = 84;
  const int16_t boxH = 26;
  int16_t boxX = visW - boxW - 8;
  int16_t boxY = visH - boxH - 8; // visual bottom-right

  // White backgrounds so the indicator stays readable over footer content.
  batteryFillRect(plane, boxX, boxY, boxW, boxH, orientation, true);

  int16_t msgX = 0;
  int16_t msgY = 0;
  int16_t msgW = int16_t(BATTERY_LOW_MSG_WIDTH) + 8;
  int16_t msgH = int16_t(BATTERY_LOW_MSG_HEIGHT) + 6;
  if (percent < 20) {
    msgX = visW - msgW - 8;
    msgY = boxY - msgH - 6;
    batteryFillRect(plane, msgX, msgY, msgW, msgH, orientation, true);
  }

  if (!isRedPlane) {
    // Black battery icon (outline + terminal + proportional fill).
    int16_t iconX = boxX + 4;
    int16_t iconY = boxY + 8;
    batteryDrawOutline(plane, iconX, iconY, 22, 10, orientation);
    batteryFillRect(plane, iconX + 22, iconY + 3, 3, 4, orientation, false);
    int fillW = (16 * percent) / 100;
    batteryFillRect(plane, iconX + 3, iconY + 3, fillW, 4, orientation, false);

    // Black percentage digits, 2x scaled 5x7 font.
    char text[4];
    snprintf(text, sizeof(text), "%d", percent);
    int16_t textX = boxX + 34;
    int16_t textY = boxY + 6;
    int scale = 2;
    for (size_t i = 0; text[i] != '\0'; i++) {
      batteryDrawChar(plane, text[i], textX + int16_t(i) * (5 * scale + 2), textY, scale, orientation);
    }
  } else if (percent < 20) {
    // Red low-battery warning.
    batteryDrawSprite(plane, msgX + 4, msgY + 3,
                      BATTERY_LOW_MSG_BITMAP, BATTERY_LOW_MSG_WIDTH, BATTERY_LOW_MSG_HEIGHT,
                      orientation);
  }
}

bool drawStoredImage() {
  File file = FFat.open(IMAGE_PATH, "r");
  if (!file || file.size() != DISPLAY_IMAGE_BYTES) {
    if (file) {
      file.close();
    }
    setError("Storage failed", "Bad saved frame", "Try again later");
    return false;
  }

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
  uint8_t* blackPlane = static_cast<uint8_t*>(malloc(DISPLAY_PLANE_BYTES));
  uint8_t* redPlane = static_cast<uint8_t*>(malloc(DISPLAY_PLANE_BYTES));
  if (!blackPlane || !redPlane) {
    free(blackPlane);
    free(redPlane);
    file.close();
    setError("Display failed", "Cannot allocate planes", "Try again later");
    return false;
  }
  logHeap("Heap after tri-color plane allocation");
  size_t blackRead = file.read(blackPlane, DISPLAY_PLANE_BYTES);
  size_t redRead = file.read(redPlane, DISPLAY_PLANE_BYTES);
  file.close();
  if (blackRead != DISPLAY_PLANE_BYTES || redRead != DISPLAY_PLANE_BYTES) {
    free(blackPlane);
    free(redPlane);
    setError("Storage failed", "Frame read error", "Try again later");
    return false;
  }

  display.init();
  display.setRotation(0);
  logHeap("Heap before tri-color drawImage");
  display.drawImage(blackPlane, redPlane, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false, false);
  free(blackPlane);
  free(redPlane);
  return true;
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
  display.init();
  display.setRotation(0);
  int batteryPercent = batteryPercentForDraw();

  // Write the two 1bpp planes one full screen at a time. This matches the
  // epaper-test full-window path and avoids many small partial-window writes,
  // which this UC8179 panel does not always refresh cleanly.
  uint8_t* plane = static_cast<uint8_t*>(malloc(DISPLAY_PLANE_BYTES));
  if (!plane) {
    file.close();
    setError("Display failed", "Cannot allocate plane", "Try again later");
    return false;
  }
  logHeap("Heap after 7.5in tri-color plane allocation");

  size_t blackRead = file.read(plane, DISPLAY_PLANE_BYTES);
  if (blackRead != DISPLAY_PLANE_BYTES) {
    free(plane);
    file.close();
    setError("Storage failed", "Frame read error", "Try again later");
    return false;
  }
  if (batteryPercent >= 0) {
    drawBatteryOnPlane(plane, batteryPercent, settings.orientation, false);
  }
  display.writeImage(plane, nullptr, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false, false);

  size_t redRead = file.read(plane, DISPLAY_PLANE_BYTES);
  if (redRead != DISPLAY_PLANE_BYTES) {
    free(plane);
    file.close();
    setError("Storage failed", "Frame read error", "Try again later");
    return false;
  }
  if (batteryPercent >= 0) {
    drawBatteryOnPlane(plane, batteryPercent, settings.orientation, true);
  }
  display.writeImage(nullptr, plane, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false, false);

  free(plane);
  file.close();
  logHeap("Heap before full refresh");
  display.refresh(false);
  return true;
#elif FRIDGE_USE_CHUNKED_4C_DRAW
  display.init();
  display.setRotation(0);
  logHeap("Heap before chunked drawNative");

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F53
  // F53 accepts sequential rows, not F52's random-access window writes.
  // This is chunking one frame in RAM, not the server's multi-page protocol.
  display.epd2.setPaged();
#endif

  for (uint16_t y = 0; y < DISPLAY_HEIGHT; y += DISPLAY_DRAW_CHUNK_ROWS) {
    uint16_t rows = DISPLAY_DRAW_CHUNK_ROWS;
    if (y + rows > DISPLAY_HEIGHT) {
      rows = DISPLAY_HEIGHT - y;
    }
    size_t bytesToRead = size_t(DISPLAY_BYTES_PER_ROW) * rows;
    size_t count = file.read(imageChunk, bytesToRead);
    if (count != bytesToRead) {
      file.close();
      setError("Storage failed", "Frame read error", "Try again later");
      return false;
    }
    display.writeNative(imageChunk, nullptr, 0, y, DISPLAY_WIDTH, rows, false, false, false);
  }

  file.close();
  logHeap("Heap before full refresh");
  display.refresh(false);
  return true;
#else
  size_t count = file.read(imageData, DISPLAY_IMAGE_BYTES);
  file.close();
  if (count != DISPLAY_IMAGE_BYTES) {
    setError("Storage failed", "Frame read error", "Try again later");
    return false;
  }

  display.init();
  display.setRotation(0);
  logHeap("Heap before full-frame drawNative");
  display.drawNative(imageData, nullptr, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false, false);
  return true;
#endif
}

void releaseNetwork() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(250);
  logHeap("Heap after Wi-Fi off");
}

void logHeap(const char* label) {
  Serial.print(label);
  Serial.print(": free=");
  Serial.print(ESP.getFreeHeap());
  Serial.print(" largest=");
  Serial.println(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
}

uint32_t contentFingerprint(const char* line1, const char* line2, const char* line3, const char* line4) {
  uint32_t hash = 2166136261u;
  const char* parts[4] = { line1, line2, line3, line4 };
  for (uint8_t i = 0; i < 4; i++) {
    for (const char* p = parts[i]; p && *p; p++) {
      hash ^= uint8_t(*p);
      hash *= 16777619u;
    }
    hash ^= 0xFFu;
    hash *= 16777619u;
  }
  return hash == 0 ? 1u : hash; // 0 is the "nothing stored" sentinel
}

uint32_t storedScreenFingerprint() {
  prefs.begin("fridge", true);
  uint32_t fingerprint = prefs.getUInt(SCREEN_FINGERPRINT_KEY, 0);
  prefs.end();
  return fingerprint;
}

void storeScreenFingerprint(uint32_t fingerprint) {
  prefs.begin("fridge", false);
  prefs.putUInt(SCREEN_FINGERPRINT_KEY, fingerprint);
  prefs.end();
}

void clearScreenFingerprint() {
  if (storedScreenFingerprint() == 0) {
    return;
  }
  prefs.begin("fridge", false);
  prefs.remove(SCREEN_FINGERPRINT_KEY);
  prefs.end();
}

void drawStatusText(const char* line1, const char* line2, const char* line3, const char* line4) {
  // One full refresh costs ~27 s of panel power. Repainting the exact page that is
  // already on screen is pure waste, so identical content keeps the current image.
  uint32_t fingerprint = contentFingerprint(line1, line2, line3, line4);
  if (fingerprint == storedScreenFingerprint()) {
    Serial.println("Same status page is already on screen; keeping the current image.");
    return;
  }
  display.init();
  display.setRotation(1);
  int16_t width = display.width();
  int16_t height = display.height();
  int16_t margin = width < 400 ? 8 : 12;
  int16_t headerHeight = width < 400 ? 40 : 54;
  int16_t textX = margin + (width < 400 ? 12 : 18);
  int16_t firstLineY = headerHeight + (height < 500 ? 68 : 130);
  int16_t lineGap = height < 500 ? 44 : 58;
#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98 || FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY075Z08
  uint16_t accentColor = GxEPD_RED;
#else
  uint16_t accentColor = GxEPD_YELLOW;
#endif
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.drawRect(margin, margin, width - 2 * margin, height - 2 * margin, GxEPD_BLACK);
    display.fillRect(margin, margin, width - 2 * margin, headerHeight, accentColor);
    display.setFont(&FreeMonoBold9pt7b);
    display.setTextColor(GxEPD_BLACK);
    display.setCursor(textX, margin + headerHeight - 17);
    display.print(DEVICE_NAME);
    display.setCursor(textX, firstLineY);
    display.print(line1);
    display.setCursor(textX, firstLineY + lineGap);
    display.print(line2);
    display.setCursor(textX, firstLineY + lineGap * 2);
    display.print(line3);
    display.setCursor(textX, firstLineY + lineGap * 3);
    display.print(line4);
  } while (display.nextPage());
  storeScreenFingerprint(fingerprint);
}

void setError(const char* title, const char* detail, const char* hint) {
  snprintf(errorTitle, sizeof(errorTitle), "%s", title);
  snprintf(errorDetail, sizeof(errorDetail), "%s", detail);
  snprintf(errorHint, sizeof(errorHint), "%s", hint);
  Serial.print(title);
  Serial.print(": ");
  Serial.println(detail);
}

// drawStatusText() already skips repainting an identical page, so this is only a
// named alias for "show the current error".
void drawErrorPage() {
  drawStatusText(errorTitle, errorDetail, errorHint);
}

bool showStoredFrame() {
  if (drawStoredImage()) {
    clearScreenFingerprint();
    return true;
  }
  drawErrorPage();
  return false;
}

void sleepForNextCheck(bool failed, uint64_t elapsedUs) {
  uint64_t targetInterval;
  if (failed) {
    recordFailure();
    // 2, 4, 8, 16, 32, then the cap. Recovery clears the counter on the next
    // successful wake, so a short outage costs at most one backoff step.
    targetInterval = uint64_t(backoffSeconds(failCount)) * 1000000ULL;
    Serial.print("Consecutive failures: ");
    Serial.print(failCount);
    Serial.print(", backoff seconds: ");
    Serial.println(backoffSeconds(failCount));
  } else {
    clearFailures();
    uint32_t targetSeconds = settings.checkIntervalMinutes * 60UL;
    if (g_nextCheckSeconds > 0) {
      // One-shot value from the server's smart schedule; the stored interval is
      // untouched and is used again as soon as the header disappears.
      targetSeconds = g_nextCheckSeconds;
      Serial.print("Using smart schedule hint seconds: ");
      Serial.println(targetSeconds);
    }
    targetInterval = uint64_t(targetSeconds) * 1000000ULL;
  }
  uint64_t interval = targetInterval > elapsedUs
    ? targetInterval - elapsedUs
    : CONFIG_APPLY_RESTART_DELAY_US;
  if (interval < CONFIG_APPLY_RESTART_DELAY_US) {
    interval = CONFIG_APPLY_RESTART_DELAY_US;
  }
  if (elapsedUs > 0) {
    Serial.print("Elapsed configuration window seconds: ");
    Serial.println(elapsedUs / 1000000ULL);
  }
  Serial.print("Sleeping for seconds: ");
  Serial.println(interval / 1000000ULL);
  Serial.flush();
  if (!g_timerWakeup) {
    // Only worth waiting on a human-triggered boot; timer wakes keep logging lean.
    delay(SERIAL_SLEEP_DELAY_MS);
  }
  if (EPD_PWR >= 0) {
    digitalWrite(EPD_PWR, LOW); // cut panel LDO during deep sleep
  }
  esp_sleep_enable_timer_wakeup(interval);
  esp_deep_sleep_start();
}

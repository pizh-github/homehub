# 小P冰箱贴 变更记录（功耗优化 + 智能调度）

范围：`esp32_epaper_fridge_tracker`（固件）、`homehub_server`（服务端 + H5）
状态：已实现，通过编译与单元测试，**尚未上实机验证**

---

## 一、固件更新了什么

| # | 改动 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | 删除多余的 `display.init()` | `.ino` setup | 304 唤醒（不重绘）时面板控制器全程保持休眠 |
| 2 | 定时唤醒跳过串口等待 | `.ino` / `Config.h` | 2.5 s → 100 ms；上电/复位保留 2.5 s（它同时是按住 BOOT 清配网的窗口，**没有改小**） |
| 3 | 屏幕内容指纹去重 | `.ino` | 待显示的状态页与屏幕上已有一致时不刷屏（一次全刷约 27 s） |
| 4 | 失败指数退避 | `.ino` / `Config.h` | 2/4/8/16/30… 分钟，**封顶就是检查间隔**；成功一次即清零 |
| 5 | Wi-Fi 信道缓存 + 兜底 | `.ino` | 记住上次信道，跳过 1–13 全扫；5 s 内连不上自动回落全扫 |
| 6 | 失败等待期 modem sleep | `.ino` | 连接等待超 4 s 才启用；下载期始终满速 |
| 7 | 局域网 / 公网判定 | `.ino` | 按服务地址形式判定；连接超时未注册 20 s，注册后局域网 8 s / 公网 10 s |
| 8 | 电池采样降频 | `.ino` | 每 50 次画面请求采样一次（30 分钟间隔约 1 天），单次仍 8 次采样；人工上电后首次刷屏强制采样；低于 20% 红色警告逻辑未变 |
| 9 | 智能调度接入 | `.ino` / `Config.h` | 请求带 `&interval=<分钟>` 上报；读取 `X-Next-Check-Seconds`（一次性睡眠秒数）与 `X-Check-Interval-Seconds`（服务端改过 interval 时下发，写入本地配置） |
| 10 | 配网页提示 | `ProvisioningPage.h` | interval 输入框下标注「此值会被账号中的设置覆盖」 |

新增 NVS key：`wch`、`failcount`、`screenfp`、`reqcount`、`batpct`、`batat`
（全部新名字；`clearSettings()` 清配网时会整体清空）。

## 二、服务端更新了什么

| # | 改动 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | 调度纯函数模块 | `src/wakeSchedule.js`（新增） | `scheduleHint()` / `localClockParts()` / `isBusyMinute()` / `segmentMinutes()` / `normalizeScheduleSettings()` / `clampIntervalToSegment()` / `clampCheckIntervalMinutes()` / `resolveScheduleReply()` |
| 2 | 数据库列 | `src/migrations.js` | `devices` 表启动时自动加 6 列：`smart_schedule_enabled`、`busy_start_minute`、`busy_end_minute`、`busy_interval_seconds`、`idle_interval_seconds`、`check_interval_minutes`，无需手工迁移 |
| 3 | 帧端点接入 | `src/server.js` | `frame.bin` / `frame.png` 的 **200 和 304** 都下发调度头；同一次请求完成 interval 上报比对 |
| 4 | 设备调度 API | `src/server.js` | `PATCH /api/devices/:id/schedule`（owner 权限），服务端做与前端一致的钳制并回显实际生效值；`GET /api/devices` 返回调度字段 |
| 5 | H5 设备页 | `public/app.js` / `public/styles.css` | 设备卡片显示检查间隔（智能调度关闭时生效）与开关状态；owner 可展开表单配置繁忙时段、两个刷新间隔下拉与检查间隔；时段长度变化时实时禁用装不下的选项 |
| 6 | 语法检查 | `package.json` | `npm run check` 纳入 `src/wakeSchedule.js` |

## 三、智能调度的规则（一句话版）

服务端按时段算出「下一次该睡多少秒」，设备照做：

```
hint = min(当前时段配置的间隔, 到时段边界的剩余秒数)
「不刷新」= 睡到时段边界 + 10 s 缓冲
```

- 繁忙时段是唯一需要配置的区间，其余时间都是空闲时段；跨零点用 `结束 < 开始` 表达。
- 间隔只能选 `5/10/15/20/30 分钟、1/2 小时、不刷新`；时段装不下的选项禁用。
- 边界那一跳 +10 s，保证设备醒来时服务端已经切换时段。
- `X-Next-Check-Seconds` 是一次性的，不改设备配置；`interval` 本身由服务端权威管理。

## 四、影响

### 功耗

- 每次唤醒：Wi-Fi 少扫全信道（约省 1.5–3 s 射频），定时唤醒少 3.25 s 串口等待，304 唤醒不再唤醒面板控制器。
- 故障态：原来「每 2 分钟 20 s 射频 + 27 s 刷屏」（估算约 500 mAh/天）变为退避重试 + 同页不重刷，回到与正常运行为同一量级。
- 智能调度：空闲时段可长睡（最长一整个时段），唤醒次数由用户配置决定；失败退避封顶在检查间隔。

### 行为变化（用户可感知）

- 屏幕上已经是同一页（含配网引导页、错误页）时不再重复刷屏；失败时尽量保留上一幅画面。
- 检查间隔以服务端为准：**在设备配网页改会被下一次请求覆盖回去**（已确认接受）；H5 的修改在下一次唤醒生效。
- 电池图标约一天更新一次读数；手动断电再上电会立即刷新。
- H5 设备页可以开关智能调度并配置时段；改动要等设备下一次醒来才生效（「不刷新」时段最长 24 小时）。

### 协议与兼容

- 请求新增 `&interval=<分钟>`；响应新增 `X-Next-Check-Seconds`、`X-Check-Interval-Seconds`，200/304 均携带。
- 老固件 + 新服务端：忽略未知头，无影响。新固件 + 老服务端：头缺失回落本地 interval，行为与原来一致。
- 数据库改动在启动时自动完成；直接改库里的 `check_interval_minutes` 即会在设备下一次请求时下发。

### 已知取舍（已确认接受）

- 设备配网页仍可改 interval，但会被服务端覆盖，界面无提示。
- 服务端数据库重置 / 恢复旧备份后，库里的 interval 会覆盖设备上的设置。
- HTTP 500 / 下载超时不算失败：不退避，按检查间隔正常重试；只有 Wi-Fi、注册、存储失败走退避。
- 深睡定时器为 RC 时钟（±5%），时段边界可能有十几分钟漂移；每次唤醒会重新对齐，不会累积。
- 智能调度打开时，`interval` 只是服务端未给值时的兜底，修改它不会立即改变节奏。

## 五、验证状态

- 固件：`pio run -e esp32c3` SUCCESS，零 warning（RAM 14.5% / Flash 49.7%）。
- 服务端：`node --test test/wakeSchedule.test.js` 17 项全过（覆盖边界分钟归属、跨零点、不刷新、
  选项钳制、interval 权威回滚、null/空值回退、时区换算）；`npm run check` 通过。
- 仓库里另有 5 个测试因 `node_modules` 未安装（缺 `openai` / `sharp` / `markdown-it` /
  `playwright`）无法运行，与本次改动无关，`npm ci` 后可恢复。
- H5 界面未做浏览器端验证，首次打开建议人工过一遍。

### 实机验证清单

1. 烧录后串口应出现 `Schedule headers: hint=…` / `Using smart schedule hint seconds: …`（智能调度开启时）。
2. 断电重上电，2.5 s 内按住 BOOT 仍能清配网。
3. 断网几分钟观察退避序列与恢复后 `failCount` 归零。
4. H5 修改 interval / 时段后，等设备下一次唤醒，确认 `Sleeping for seconds` 与
   `Interval updated by server` 日志符合预期。

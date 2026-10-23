# 小P家事板（HomeHub）

家庭生活工作台的本地服务，把「家里那些需要被记住、被安排的事」集中到一个 H5 页面里，并同步到低功耗墨水屏：

- **家庭物品**：有效期管理、到期提醒、地点复用、搜索筛选、墨水屏画面
- **健身训练**：训练项目维护、按权重随机抽取每日训练、组打卡、有氧记录、日历预约、历史统计
- **账号与家庭**：邀请码注册、家庭共享、成员管理、超级管理员、账号删除与昵称
- **AI 助手 / MCP**：内置文字助手管理物品与健身，也可通过 MCP 令牌接入 Codex 等外部 Agent

> 本项目基于开源项目 [xueyouluo/fridge_tracker](https://github.com/xueyouluo/fridge_tracker) 二次开发，在其冰箱物品与电子墨水屏能力之上做了较大扩展。上游已有功能全部保留。

## 目录

- [功能特性](#功能特性)
- [相对上游项目的变化](#相对上游项目的变化)
- [快速开始（本地开发）](#快速开始本地开发)
- [Docker 部署（推荐）](#docker-部署推荐)
- [config.json 配置说明](#configjson-配置说明)
- [账号与权限](#账号与权限)
- [健身板块](#健身板块)
- [AI 助手与 MCP](#ai-助手与-mcp)
- [接口清单](#接口清单)
- [验证与测试](#验证与测试)
- [Roadmap](#roadmap)
- [许可证](#许可证)

## 功能特性

### 家庭物品与墨水屏

- 添加物品时可直接填到期日，也可填「起始日期 + 有效天数」自动推算；有效天数 0–36500。
- 地点为可选字段（最长 40 字），H5 复用当前家庭用过的地点，支持搜索与精确筛选。
- 按上海时区计算到期状态，列表与屏幕都优先展示最紧急的物品。
  - `daysRemaining < 0`：已过期（红）
  - `0 <= daysRemaining <= 3`：即将到期（四色屏黄 / 三色屏红，加粗下划线）
  - 其余：正常（黑）
- 支持面板：`GDEM075F52` / `GDEM075F53` / `GDEM0397F81`（7.5 与 3.97 寸四色）、`GDEY042Z98`（4.2 寸三色）、`GDEY075Z08`（7.5 寸三色）。
- 使用 Playwright + sharp 在服务端把 HTML 渲染为设备原生帧，并向设备提供 `ETag`，内容未变化时返回 304。
- H5 提供「全屏展示」模式，可把手机/平板当作常亮副屏。

### 健身训练

- 训练项目分**无氧**（组数、每组次数、重量、单边/全部）与**有氧**（时间、距离、坡度），各有项目权重（0.5 / 1 / 1.5 / 2）。
- 每天点「开始训练」时才按「每天权重目标和」随机抽取项目；抽取使用子集和求解 + 按历史选中次数加权，保证长期各项目被练到的次数趋于均衡，并尽量避免连续两天重复。
- 无氧逐组打勾；有氧单个打勾，打勾时弹窗确认实际时间/距离/坡度，可附心率与备注，作为最终历史保存。
- 结束训练、撤回结束；日历标记已完成/进行中/已预约，未来日期可预约；训练历史卡展示最近 30 天。
- 连续 N 天没练（默认 3 天，可配）时页面顶部提醒（只在练过至少一次后生效）。

详细规则见 [`docs/fitness-design.md`](docs/fitness-design.md)。

### 账号与权限

- **邀请码注册**：新账号必须使用管理员发放的注册邀请码（24 小时有效、一次性）。成员邀请码注册后加入发码人的家庭；管理员邀请码注册后成为新管理员并建立自己的家庭。数据库中没有任何用户时（全新空库），首个注册账号免邀请码并自动成为管理员。
- **家庭共享**：物品、设备按家庭隔离；家庭创建者可邀请成员、配对设备、移除成员。
- **超级管理员**：`config.json` 的 `adminLogin` 对应的账号即超级管理员（与创建时间无关），唯一可以删除其他管理员；删除管理员时连同其家庭的全部成员账号与内容一起删除。
- **删除账号**：需要输入当前操作者自己的密码二次确认。
- **昵称**：任何用户都可以在「用户 → 当前账号」修改自己的显示名。
- **Agent 额度**：新账号默认 100 次系统 Agent 输入额度，管理员可为任意账号调整；个人 API Key 不消耗系统额度。

### AI 助手与 MCP

- 内置文字助手（可选语音输入）可批量管理物品，并支持健身项目的增改与训练预约。
- 删除物品必须经过系统生成的确认卡；开始训练、打卡、结束训练**不开放**给 AI，需本人在健身页完成。
- Streamable HTTP MCP（`POST /mcp`，Bearer 个人访问令牌）提供与内置助手相同的工具集，可接入 Codex 等客户端。

## 相对上游项目的变化

| 板块 | 说明 |
|---|---|
| 健身板块 | **全新**：训练项目 CRUD、每日权重抽取、无氧组打卡、有氧打卡（时间/距离/坡度/心率/备注）、结束与撤回、日历预约、历史、提醒 |
| 注册方式 | 从「邮箱开放注册」改为**用户名 + 邀请码**注册，支持成员/管理员两种邀请码；空库时首个注册者免邀请码并自动成为管理员 |
| 账号管理 | **新增**：管理员删除账号（需输入自己密码）、超管删除管理员（连带其家庭成员与内容）、显示名自助修改、超管标识 |
| 超级管理员 | 由 `config.json` 的 `adminLogin` 动态界定，可删除其他管理员 |
| AI / MCP | 新增 8 个健身工具（查看项目/概览/某天/历史、建改项目、预约/取消预约），训练打卡类操作刻意不开放 |
| 面板支持 | 新增 `GDEY075Z08`（7.5 寸三色）与三色大屏渲染布局，三色屏按黑白红双平面出帧 |
| 品牌 | 「小P冰箱贴」更名为「小P家事板（HomeHub）」；MCP server 名 `homehub`，令牌环境变量 `HOMEHUB_MCP_TOKEN` |
| 其它 | 登录 cookie（`homehub_session`）、数据库文件（`data/homehub.sqlite`）、npm 包名（`homehub-server`）统一为新名；像素字体（Unifont / Fusion Pixel）随仓库分发 |

## 快速开始（本地开发）

需要 Node.js **22.5+**（推荐 24）。

```sh
npm install
npm run install:browsers     # 下载 Playwright 管理的 Chromium（墨水屏渲染用）
cp config.example.json config.json   # 按需修改管理员账号与密钥
npm start
```

打开 <http://127.0.0.1:8788>。未创建 `config.json` 时服务会自动建库并使用演示默认值（见 `src/server.js` 的 `DEFAULT_CONFIG`）：

```text
账号: admin / 密码: homehub-demo
演示设备 token: local-homehub-device-token
```

其它命令：

```sh
npm run dev      # --watch 热重启
npm run check    # 语法检查（所有 src 与 public 脚本）
npm test         # node --test，全部单元/集成测试
```

## Docker 部署（推荐）

**仓库根目录即部署目录**：代码、`config.json`、`data/`、`Dockerfile`、`docker-compose.yml` 放在一起。

### 1. 目录结构

```text
/vol1/1000/Docker/homehub/        ← 仓库根（示例路径，按你的环境替换）
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── config.json                   ← 自己创建，已被 .gitignore 忽略
├── data/                         ← 数据库，运行时自动创建
│   └── homehub.sqlite
├── src/  public/  assets/
└── test/ docs/
```

### 2. 准备配置

```sh
git clone <本仓库> /vol1/1000/Docker/homehub
cd /vol1/1000/Docker/homehub
cp config.example.json config.json
openssl rand -hex 32    # 用于 credentialEncryptionKey
openssl rand -hex 16    # 用于 demoDeviceToken
vi config.json          # 填 adminLogin / adminPassword / 上面两个随机串
chmod 600 config.json
mkdir -p data
```

字段含义见 [config.json 配置说明](#configjson-配置说明)。

### 3. 启动

```sh
sudo docker compose up -d --build      # 首次构建会下载 Chromium，5~15 分钟
sudo docker compose logs -f homehub
```

看到下面两行即成功：

```text
XianZhi Tie listening on http://0.0.0.0:8788
Database: /app/data/homehub.sqlite
```

浏览器打开 `http://<NAS 内网 IP>:8788`，用 `adminLogin` / `adminPassword` 登录。

### 4. 镜像构建的常见网络问题

| 现象 | 处理 |
|---|---|
| `failed to resolve source metadata for docker.io/library/node:...`（502） | Docker 镜像加速源失效。改用可用源，或先 `docker pull docker.m.daocloud.io/library/node:22-bookworm-slim` 再 `docker tag` 成本地同名镜像 |
| `playwright install` 下载极慢/超时 | 取消 Dockerfile 中 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` 的注释后重建 |
| 首次启动 `npm ci` 慢 | 在 compose 的 command 里改用 `npm ci --registry=https://registry.npmmirror.com` |

### 5. 日常维护

| 场景 | 操作 |
|---|---|
| 更新业务代码（src / public） | 拉取新代码后 `sudo docker compose restart homehub`（源码是挂载的，无需重建镜像） |
| 变更依赖（package.json） | `sudo docker compose down` → `sudo docker volume rm homehub_homehub_node_modules` → `sudo docker compose up -d` |
| 修改 Dockerfile / 升级 Playwright | `sudo docker compose up -d --build` |
| 修改 config.json | `sudo docker compose restart homehub` |
| 更换超级管理员 | 改 `adminLogin` 后重启（该账号密码会被 `adminPassword` 覆盖） |
| 查看日志 | `sudo docker compose logs -f --tail 100 homehub` |
| 备份数据 | 先 `sudo docker compose stop`，再 `cp -a data /vol1/1000/backup/homehub-$(date +%F)` |

### 6. 关于 config.json 与密钥

- `config.json` 含密钥，**不要提交到 Git**（已在 `.gitignore` 中）。
- `credentialEncryptionKey` 用于 AES-256-GCM 加密用户填写的模型 API Key；**部署后不要随意更换**，否则已保存的 Key 无法解密。
- 若未设置 `credentialEncryptionKey`，会兼容性地使用 `adminPassword` 作为加密密钥（不建议）。

## config.json 配置说明

| 字段 | 默认值 | 说明 |
|---|---|---|
| `host` | `127.0.0.1` | 监听地址；容器内用 `0.0.0.0`（Docker 部署由环境变量 `HOST` 覆盖） |
| `port` | `8788` | 监听端口 |
| `timezone` | `Asia/Shanghai` | 计算到期与训练日期使用的时区 |
| `databasePath` | `data/homehub.sqlite` | SQLite 文件路径（相对仓库根） |
| `secureCookies` | `false` | 仅 HTTPS 直连时设为 `true`；反向代理终结 TLS 时保持 `false` |
| `adminLogin` | `admin` | 初始管理员登录名，**该账号即超级管理员** |
| `adminEmail` | 空 | 可选：给管理员账号写一个邮箱登录别名；不影响其他功能 |
| `adminPassword` | `homehub-demo` | 管理员密码；改后重启生效，并使该账号历史会话失效 |
| `demoDeviceToken` | `local-homehub-device-token` | 演示设备（serial=`local-demo-screen`）的访问令牌 |
| `credentialEncryptionKey` | 空 | 模型 API Key 的加密密钥，部署后勿更换 |
| `asrApiKey` / `asrModel` / `asrBaseUrl` | 空 / `fun-asr-flash-2026-06-15` / 空 | 可选的系统语音识别（ASR）配置；未配置时语音输入不可用 |

## 账号与权限

### 注册

1. 管理员在「用户 → 注册邀请码」生成邀请码：**成员邀请码**（注册后加入你的家庭）或**管理员邀请码**（注册后成为新管理员，建立自己的家庭）。
2. 邀请码 24 小时有效、只能使用一次，明文只显示一次（服务端只存 SHA-256），可随时撤销未使用的码。
3. 注册页填写**用户名**（唯一，作为登录名）、邀请码、可选显示名与密码；登录时用户名或历史邮箱均可。
4. 数据库中没有任何用户时（全新空库），首个注册无需邀请码并自动成为管理员。

### 超级管理员

- `config.json` 的 `adminLogin` 账号即超级管理员，用户列表中带黄色「超级管理员」徽章。
- 只有超管能删除其他管理员；删除管理员会连带删除其家庭内所有成员账号、物品、设备绑定与训练数据。
- 普通管理员可以删除普通成员（不能删自己）；家庭还有其他人时只删账号、物品保留；家庭只剩其一人时家庭与物品一并删除。
- 删除账号需要输入**当前操作者自己的密码**确认。

### 昵称

「用户 → 当前账号 → 显示名」可随时修改；留空则回退为登录名。家庭动态中的历史记录保留当时的操作信息。

## 健身板块

- **项目**：无氧（组数/次数/重量/单边或全部）与有氧（默认时间/距离/坡度），权重 0.5/1/1.5/2，用于每日预算。
- **每日抽取**：每天第一次点「开始训练」时，将权重乘 2 转为整数，在未归档项目上求「和等于目标」的子集；无精确解时取最接近且不超过目标的组合；所有项目都超过目标时取最小项并提示。抽样按 `∏ 1/(选中次数+1)` 加权，长期趋于公平；会优先排除昨天/今天刚练过的项目。
- **打卡**：无氧逐组点击打勾/取消；有氧点一下打勾，弹窗确认实际数据（时间/距离/坡度，选填心率与备注），并显示自动计算的配速/速度。
- **结束与撤回**：「结束训练」不要求全部打钩；结束后可「撤回结束」，结果保留。
- **日历与预约**：已完成（绿）、进行中（黄）、已预约（虚线框），今天高亮；点未来日期预约/取消预约，预约当天仍需手动「开始训练」。
- **历史**：最近 30 天列表 + 任意日期详情（含每组完成情况、有氧实际数据与备注）。
- **提醒**：连续 `remind_after_days`（默认 3）天未完成训练且今天没有进行中/已完成记录时，页面顶部提示。

完整设计见 [`docs/fitness-design.md`](docs/fitness-design.md)。

## AI 助手与 MCP

### 内置助手

- 管理员在「用户 → 系统 Agent」配置 API Key / 模型 / Base URL，供未配置个人 Key 的用户使用；用户也可在「我的 Agent」填自己的配置（优先，且不消耗系统额度）。
- 当前统一使用 Chat Completions API，兼容 OpenAI 与常见 OpenAI-compatible 服务（如 DeepSeek）。
- 删除物品会生成 5 分钟有效的确认卡；健身的建改项目与预约直接执行，训练打卡类操作不开放。

### MCP

「用户 → Agent 接入」创建个人访问令牌（默认 90 天，可撤销），MCP 地址为 `http://<你的地址>/mcp`。Codex 配置示例：

```toml
[mcp_servers.homehub]
url = "https://<你的域名>/mcp"
bearer_token_env_var = "HOMEHUB_MCP_TOKEN"
```

```sh
export HOMEHUB_MCP_TOKEN='...'
```

### 工具清单

| 工具 | 说明 |
|---|---|
| `list_items` / `get_items` / `create_items` / `update_items` / `delete_items` | 家庭有效期物品的查询与批量增删改（删除需确认卡） |
| `list_fitness_exercises` | 查看训练项目（ID、类型、参数、权重、被选中次数） |
| `create_fitness_exercise` / `update_fitness_exercise` | 新建 / 部分更新训练项目 |
| `plan_workout_day` / `unplan_workout_day` | 预约 / 取消预约未来某天的训练 |
| `get_fitness_overview` / `get_fitness_day` / `list_fitness_history` | 今日概览与提醒、某天详情、日期范围历史 |

> 开始训练、组打卡、有氧打卡、结束训练**只能由用户本人在健身页操作**，不通过 AI 执行，避免污染历史数据。

## 接口清单

浏览器会话接口（需登录）：

```text
POST   /api/auth/login                 POST   /api/auth/register
POST   /api/auth/logout                GET    /api/auth/me
GET    /api/users                      PATCH  /api/users/me                # 修改显示名
PATCH  /api/users/:id/agent-quota      DELETE /api/users/:id               # 需 body.password
GET    /api/registration-invites       POST   /api/registration-invites    # 管理员
DELETE /api/registration-invites/:id   # 管理员撤销未使用邀请码

GET    /api/household                  POST   /api/household/invites
GET    /api/household/invites/inspect  POST   /api/household/invites/accept
DELETE /api/household/members/:id      POST   /api/household/leave
GET    /api/activities

GET    /api/foods                      POST   /api/foods
PATCH  /api/foods/:id                  DELETE /api/foods/:id
POST   /api/foods/batch

GET    /api/devices                    POST   /api/devices/pairing-codes
GET    /api/display/preview            GET    /api/display/frame.png

GET    /api/fitness/overview           GET    /api/fitness/settings
PUT    /api/fitness/settings
GET    /api/fitness/exercises          POST   /api/fitness/exercises
PUT    /api/fitness/exercises/:id      DELETE /api/fitness/exercises/:id
GET    /api/fitness/days/:date
POST   /api/fitness/days/:date/start   POST   /api/fitness/days/:date/regenerate
POST   /api/fitness/days/:date/finish  POST   /api/fitness/days/:date/reopen
POST   /api/fitness/days/:date/plan    DELETE /api/fitness/days/:date/plan
POST   /api/fitness/days/:date/sets/:exerciseId/:setIndex/toggle
POST   /api/fitness/days/:date/aerobic/:exerciseId
GET    /api/fitness/calendar?month=YYYY-MM
GET    /api/fitness/history?from=YYYY-MM-DD&to=YYYY-MM-DD

GET    /api/access-tokens              POST   /api/access-tokens
DELETE /api/access-tokens/:id

GET    /api/agent/conversations        POST   /api/agent/conversations
GET    /api/agent/conversations/:id/messages
DELETE /api/agent/conversations/:id
GET    /api/agent/settings             PUT    /api/agent/settings
DELETE /api/agent/settings
GET    /api/admin/agent/settings       PUT    /api/admin/agent/settings
DELETE /api/admin/agent/settings
GET    /api/agent/voice-settings       POST   /api/agent/transcriptions
POST   /api/agent/messages             POST   /api/agent/messages/stream
POST   /api/agent/actions/:id/confirm  POST   /api/agent/actions/:id/cancel

GET    /api/health
```

设备接口（Bearer 设备令牌）与 MCP：

```text
POST /api/device/register
GET  /api/device/frame.bin?panel=gdem075f52&orientation=portrait
GET  /api/device/frame.png?panel=gdem075f52&orientation=portrait
POST /mcp                     # MCP Streamable HTTP，Authorization: Bearer <个人令牌>
```

帧协议：四色 96,000 B（2bpp-bwyr 每字节 4 像素）；4.2 寸三色 30,000 B、7.5 寸三色 96,000 B（均为双 1-bit 黑白平面 + 红色平面，白色像素两位均为 1）。

## 验证与测试

```sh
npm run check     # 语法检查
npm test          # 全部测试（应全部通过）
```

测试覆盖：领域规则、物品服务、家庭与邀请、账号与权限、删除用户、注册邀请码、Agent 工具、MCP 工具、健身抽取公平性与完整流程、UI 静态契约等。

## Roadmap

- **备忘录页面**：计划新增与「概览 / 物品 / 设备 / 健身 / 助手 / 用户」同级的备忘视图。
- 用户列表的搜索与分页（当前一次性列出全部账号）。

## 许可证

沿用上游项目的 **PolyForm Noncommercial 1.0.0** 许可证（非商业用途）。二次分发请保留上游出处与许可证说明。

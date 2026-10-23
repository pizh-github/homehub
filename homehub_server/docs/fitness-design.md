# 健身板块设计方案

> 状态：待确认 / 已确认部分见文末
> 范围：服务端 + H5 前端
> 原则：健身板块**只与 user 绑定**，**不参与墨水屏刷新**，不修改渲染器、帧协议和固件。

---

## 1. 需求概述

新增一个和「概览、物品、设备、助手、用户」并列的独立页面：**健身**。

核心能力：

1. 训练项目管理：名称、组数、每组次数、重量、重量类型、项目权重。
2. 每天按权重目标随机抽取训练项目，只有点击「开始训练」后才生成当天项目。
3. 每组完成可打 √，可取消。
4. 一天结束有「结束训练」，结果保存，可撤回结束。
5. 日历：标记哪天练了，可预约未来哪天要练。
6. 长期公平：各个项目都能被练到，次数尽量接近。
7. x 天没练后 H5 提醒。
8. UI 风格与现有 H5 一致。

### 已确认的决策

| 问题 | 决策 |
|---|---|
| 重量类型 | 增加「单边 / 全部」区分 |
| 项目权重取值 | 默认 1，支持 0.5 / 1 / 1.5 / 2 |
| 每天项目数 | 改为「每天权重目标和」，默认 5，用户可修改；当天选中项目的权重之和应等于该值 |
| 重量单位 | kg，保留小数 |
| 提醒 | 仅 H5 页面提醒，不上墨水屏、不做手机推送 |
| 历史结果 | 只记录哪天练了 + 每组是否完成，不记录实际重量/次数 |
| 页面形态 | 独立页面，与概览/物品/设备/助手/用户同级 |
| 实现方式 | 本文件只做设计，后续由其他 agent 实现 |

---

## 2. 数据模型

所有表均为 `user_id` 维度，不按家庭共享。

### 2.1 `fitness_exercises` — 训练项目

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 主键 |
| user_id | INTEGER NOT NULL | 归属用户，`REFERENCES users(id) ON DELETE CASCADE` |
| name | TEXT NOT NULL | 项目名称 |
| type | TEXT NOT NULL DEFAULT 'anaerobic' | `anaerobic` = 无氧（默认），`aerobic` = 有氧（跑步等）；`CHECK (type IN ('anaerobic','aerobic'))` |
| sets | INTEGER NOT NULL DEFAULT 3 | 组数（仅无氧使用） |
| reps | INTEGER NOT NULL DEFAULT 12 | 每组次数（仅无氧使用） |
| weight_kg | REAL NOT NULL DEFAULT 0 | 重量，kg，保留 1 位小数（仅无氧使用） |
| weight_mode | TEXT NOT NULL DEFAULT 'total' | `single` = 单边，`total` = 全部；`CHECK (weight_mode IN ('single','total'))` |
| default_duration_min | REAL NOT NULL DEFAULT 30 | 有氧默认时间，分钟，保留 1 位小数 |
| default_distance_km | REAL NOT NULL DEFAULT 5 | 有氧默认距离，km，保留 2 位小数 |
| default_incline | REAL NOT NULL DEFAULT 0 | 有氧默认坡度，%，保留 1 位小数 |
| priority_weight | REAL NOT NULL DEFAULT 1 | 项目权重，仅允许 `0.5 / 1.0 / 1.5 / 2.0` |
| selection_count | INTEGER NOT NULL DEFAULT 0 | 累计被选中次数，用于长期公平 |
| last_selected_date | TEXT | 上次被选中日期，`YYYY-MM-DD` |
| archived | INTEGER NOT NULL DEFAULT 0 | 软删除：0 正常，1 归档 |
| sort_order | INTEGER NOT NULL DEFAULT 0 | 手动排序 |
| created_at | TEXT NOT NULL | 创建时间 |
| updated_at | TEXT NOT NULL | 更新时间 |

索引：`idx_fitness_exercises_user ON fitness_exercises(user_id, archived, sort_order)`。

### 2.2 `fitness_settings` — 用户设置

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | INTEGER PK | 一人一行 |
| daily_weight_target | REAL NOT NULL DEFAULT 5 | 每天权重目标和，即需求中的 `daily_exercise_count` |
| remind_after_days | INTEGER NOT NULL DEFAULT 3 | x 天没练后提醒 |
| created_at | TEXT NOT NULL | 创建时间 |
| updated_at | TEXT NOT NULL | 更新时间 |

约束：

- `daily_weight_target >= 0.5`；
- 前端按 0.5 步进调整。

### 2.3 `fitness_workout_days` — 每天训练记录

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 主键 |
| user_id | INTEGER NOT NULL | 归属用户 |
| workout_date | TEXT NOT NULL | `YYYY-MM-DD` |
| status | TEXT NOT NULL DEFAULT 'planned' | `planned` / `active` / `completed` |
| selected_exercises_json | TEXT | 点击「开始训练」后生成的当天项目快照 |
| started_at | TEXT | 开始时间 |
| completed_at | TEXT | 结束时间 |

约束：`UNIQUE(user_id, workout_date)`。

`selected_exercises_json` 结构：

```json
[
  {
    "exerciseId": 1,
    "name": "卧推",
    "sets": 3,
    "reps": 12,
    "weightKg": 20.0,
    "weightMode": "total",
    "priorityWeight": 2.0
  }
]
```

### 2.4 `fitness_set_results` — 每组完成情况

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 主键 |
| workout_day_id | INTEGER NOT NULL | `REFERENCES fitness_workout_days(id) ON DELETE CASCADE` |
| exercise_id | INTEGER | 关联项目 |
| set_index | INTEGER NOT NULL | 第几组，从 0 开始 |
| completed | INTEGER NOT NULL DEFAULT 0 | 0 未完成，1 已完成 |
| completed_at | TEXT | 打 √ 时间 |

约束：`UNIQUE(workout_day_id, exercise_id, set_index)`。

---

## 3. 每日随机项目生成算法

### 3.1 触发时机

- 只有用户点击「开始训练」时才生成当天项目。
- 未点击前，不计算、不保存、不展示当天项目。
- 已生成后，点击「重新生成」会清空当天 set 结果并重新抽取。

### 3.2 输入

- 用户未归档的项目列表；
- `daily_weight_target`，记为 `T`；
- 每个项目的 `priority_weight`，记为 `w_i`。

### 3.3 权重归一化

所有权重和目标都乘以 2，转为整数：

```text
cost_i = priority_weight_i * 2   # 1 / 2 / 3 / 4
C      = daily_weight_target * 2  # 默认 10
```

### 3.4 候选集

1. 取未归档项目。
2. 如果候选数充足，先排除 `last_selected_date` 为昨天或今天的项目，避免连续重复。
3. 若排除后无法凑出有效组合，则回退到完整候选集。

### 3.5 子集和求解

在候选集上求解**子集和**，目标是选中项目的 `cost_i` 之和等于 `C`：

- 先找**恰好等于 C** 的所有子集。
- 若不存在恰好等于 C 的子集，则找**和小于 C 且最接近 C** 的子集。
- 若仍不存在（所有项目 cost 都大于 C），则选择 **cost 最小** 的单个项目，并在 UI 提示「当前目标权重小于最小项目权重」。

### 3.6 公平性抽样

对每个有效子集，计算子集得分：

```text
subset_score = ∏ ( 1 / (selection_count_i + 1) )
```

按 `subset_score` 作为权重，在所有有效子集中随机抽取一个。

这样：

- `selection_count` 越高的项目，越不容易再次被选中；
- 长期来看，各项目被选次数会趋于接近；
- 项目权重只表示「消耗多少当天预算」，不表示抽中概率，因此不会因为权重差异导致某些项目长期练不到。

### 3.7 选中后

- 对选中项目：`selection_count += 1`，`last_selected_date = 今天`；
- 写入 `fitness_workout_days.selected_exercises_json`；
- 当天状态改为 `active`；
- 为每个选中项目的每一组，初始化 `fitness_set_results`（`completed = 0`）。

---

## 4. 训练流程

```text
健身页 → 今日训练卡
  ├── 无记录：显示「开始训练」
  ├── planned：显示「开始训练」（生成项目并置为 active）
  ├── active：
  │     ├── 展示当天项目快照
  │     ├── 每组点击 √ / 再点取消 √
  │     ├── 「重新生成」：清空当天结果并重新抽项目
  │     └── 「结束训练」：status = completed
  └── completed：
        ├── 展示当天完成摘要
        └── 「撤回结束」：status 回到 active，结果保留
```

- 结束训练不要求所有组都打 √，用户可随时结束。
- 撤回只针对「结束」操作；单组撤回通过再次点击 √ 完成。

---

## 5. 日历与预约

- 日历按月份展示。
- 每日状态：
  - 今天：高亮边框；
  - `completed`：绿色实心标记；
  - `active`：进行中标记；
  - `planned`：预约标记；
  - 过去未练：灰色；
  - 未来未预约：空白。
- 点击未来日期：预约 / 取消预约。
- 点击过去日期：只读查看当天项目、每组完成情况、结束时间。
- 预约日期当天，用户仍需要点击「开始训练」才会生成项目。

---

## 6. 提醒

- 用户可设置 `remind_after_days`，默认 3。
- 服务端计算 `days_since_last_completed`。
- 当 `days_since_last_completed >= remind_after_days` 且今天没有 completed/active 记录时，返回提醒。
- 从未完成过任何训练的用户不提醒（`days_since_last_completed` 为空），只有练过至少一次后才开始计算。
- 前端在健身页顶部显示提醒条，例如：

```text
你已经 5 天没练了，该动一动了
```

- 仅 H5 提醒，不上墨水屏，不做手机推送。

---

## 7. API 设计

所有接口使用当前登录用户身份，前缀 `/api/fitness`。

### 7.1 概览与设置

```text
GET /api/fitness/overview
    → {
        today: { date, status, exercises, completedSets, totalSets },
        daysSinceLastCompleted,
        remindAfterDays,
        shouldRemind,
        totalExercises,
        activeExercises
      }

GET /api/fitness/settings
PUT /api/fitness/settings
    body: { dailyWeightTarget: 5, remindAfterDays: 3 }
```

### 7.2 训练项目

```text
GET    /api/fitness/exercises
POST   /api/fitness/exercises
       body: { name, sets, reps, weightKg, weightMode, priorityWeight, sortOrder }
PUT    /api/fitness/exercises/:id
DELETE /api/fitness/exercises/:id       # 软删除 archived = 1
```

### 7.3 每日训练

```text
POST   /api/fitness/days/:date/start          # 开始训练，生成当天项目
POST   /api/fitness/days/:date/regenerate     # 重新生成当天项目
GET    /api/fitness/days/:date                # 当天详情
POST   /api/fitness/days/:date/sets/:exerciseId/:setIndex/toggle
POST   /api/fitness/days/:date/finish
POST   /api/fitness/days/:date/reopen
```

### 7.4 日历与预约

```text
GET    /api/fitness/calendar?month=YYYY-MM
POST   /api/fitness/days/:date/plan
DELETE /api/fitness/days/:date/plan
```

### 7.5 历史

```text
GET /api/fitness/history?from=YYYY-MM-DD&to=YYYY-MM-DD
```

---

## 8. UI 设计

### 8.1 入口

侧边栏 / 顶部导航新增「健身」，与「概览、物品、设备、助手、用户」同级。

### 8.2 页面结构

```text
健身页
├── 提醒条（满足提醒条件时显示）
├── 今日训练卡
│   ├── 未开始：大按钮「开始训练」
│   ├── 进行中：项目列表 + 每组√ + 完成进度 + 「重新生成」+「结束训练」
│   └── 已完成：结果摘要 + 「撤回结束」
├── 训练项目卡
│   ├── 项目列表：名称 / 组数×次数 / 重量 / 重量类型 / 权重
│   └── 新增 / 编辑 / 删除
├── 日历卡
│   ├── 月历 + 状态标记
│   └── 点未来日期预约 / 取消
└── 设置卡
    ├── 每天权重目标和（0.5 步进）
    └── x 天没练提醒
```

### 8.3 训练项目展示

每个项目一行：

```text
卧推
20.0 kg(全部) × 12 × 3组   权重 2.0
```

或单边项目：

```text
哑铃弯举
10.0 kg(单边) × 12 × 3组   权重 1.0
```

### 8.4 今日训练交互

- 每个项目显示快照信息；
- 每组为一个圆形/方形点击块：
  - 未完成：描边；
  - 已完成：填充绿色，带 √；
- 顶部显示进度条：`已完成 x / y 组`；
- 「结束训练」为当前页面主按钮；
- 「重新生成」为次要按钮，点击前弹确认。

### 8.5 风格

- 复用现有 `panel`、`section-head`、`pill`、`muted`、`hidden` 等样式；
- 按钮使用现有三级控制体系；
- 完成/提醒使用现有绿色、橙色、红色语义；
- 弹窗编辑项目与「物品编辑」弹窗结构一致。

---

## 9. 技术实现计划

| 文件 | 改动 |
|---|---|
| `src/server.js` | 新增 fitness 路由；`initializeDatabase()` 增加建表 |
| `src/migrations.js` | 新增 `migrateFitnessTables()`，使用 `CREATE TABLE IF NOT EXISTS`，幂等 |
| `src/fitness.js` | 新增服务模块：校验、子集和抽取、训练流程、日历、提醒、历史 |
| `public/index.html` | 新增健身页面结构和导航入口 |
| `public/fitness.js` | 新增前端逻辑（独立文件，避免 `app.js` 继续膨胀） |
| `public/styles.css` | 增加健身样式，沿用现有设计变量 |
| `test/fitness.test.js` | 测试：项目 CRUD、权重和抽取、公平性、训练流程、日历、提醒 |

### 9.1 服务端实现要点

- `priority_weight` 服务端校验：仅允许 `0.5 / 1.0 / 1.5 / 2.0`。
- `weight_mode` 校验：仅允许 `single` / `total`。
- `daily_weight_target` 校验：`>= 0.5`，且按 0.5 步进。
- 子集和算法实现建议：
  - 项目数量通常很小，直接 DP / 回溯即可；
  - 权重和目标先乘 2 转整数；
  - 对有效子集加权随机抽样。
- 所有日期使用 `YYYY-MM-DD`，与现有 `localDateKey` 保持一致。

### 9.2 迁移与部署

- 新表在服务启动时自动创建；
- 不需要手动改 SQLite；
- 部署前备份 `data/homehub.sqlite`；
- 同步代码后 `docker compose restart homehub`。

---

## 10. 待确认 / 默认处理

1. ~~重量类型~~ → 已确认：增加「单边 / 全部」。
2. ~~项目权重取值~~ → 已确认：0.5 / 1.0 / 1.5 / 2.0，默认 1。
3. ~~每天项目数~~ → 已确认：改为「每天权重目标和」，默认 5，当天权重之和等于该值。
4. ~~重量单位~~ → 已确认：kg，保留小数。
5. ~~提醒~~ → 已确认：仅 H5。
6. ~~历史结果~~ → 已确认：不记录实际重量/次数。
7. 未明确但按默认处理：
   - 预约日期当天仍需手动点「开始训练」；
   - 项目删除采用软删除；
   - 若目标权重无法精确凑出，选择最接近且不超过目标的子集；
   - 若所有项目权重都大于目标，选择权重最小的单个项目并提示。
8. 已补充确认（实现前确认）：
   - 提醒只在练过至少一次后生效，从未练过不提醒；
   - 除日历点击过去日期查看详情外，额外提供「训练历史」卡，展示最近 30 天记录摘要；
   - 重新生成时会回滚旧快照项目的 `selection_count`，避免多次重新生成虚增公平性计数。
9. 有氧项目（已确认实现）：
   - 项目增加 `type` 区分有氧 / 无氧，有氧项目（跑步等）录入默认时间、距离、坡度；
   - 有氧不显示组数、次数、重量、重量类型，不使用组打卡；
   - 训练中给有氧打钩时弹出确认小窗，可修改时间 / 距离 / 坡度，保存后作为最终历史数据；
   - 结束训练时未打钩的有氧视为未完成；已打钩的可再次打开小窗修改数据或取消打卡；
   - 实际数据存入新表 `fitness_aerobic_results`；有氧项目在进度统计中按 1 个打卡单元计；
   - 有氧项目同样参与每日随机抽取与 `priority_weight` 权重预算；
   - 旧库由 `migrateFitnessExerciseColumns()` 自动 `ALTER TABLE` 补列，旧项目默认为无氧。
10. 有氧确认小窗附加参数（已确认实现）：
   - 配速 / 速度由时间与距离自动换算显示（`5'19" /km` 与 `km/h`），不录入、不存库；
   - 平均心率（整数 0–250）为选填，0 表示未记录，存入 `fitness_aerobic_results`；
   - 备注为选填自由文本，自动 trim 并截断 100 字；
   - 旧库由 `migrateFitnessAerobicColumns()` 自动补列；心率 / 备注有值时在历史详情中展示；
   - 消耗 kcal 经确认不做（2026-07 决定移除）。

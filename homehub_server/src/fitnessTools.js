"use strict";

const z = require("zod/v4");

const exerciseFields = {
  name: z.string().min(1).max(40).describe("训练项目名称，例如 卧推、跑步"),
  type: z.enum(["anaerobic", "aerobic"]).optional().describe("anaerobic = 无氧（力量，默认），aerobic = 有氧（跑步等）"),
  sets: z.number().int().min(1).max(20).optional().describe("组数，仅无氧使用，默认 3"),
  reps: z.number().int().min(1).max(500).optional().describe("每组次数，仅无氧使用，默认 12"),
  weightKg: z.number().min(0).max(1000).optional().describe("重量 kg，仅无氧使用，默认为 0"),
  weightMode: z.enum(["single", "total"]).optional().describe("single = 单边，total = 全部，仅无氧使用，默认 total"),
  defaultDurationMin: z.number().min(0).max(1440).optional().describe("有氧默认时间（分钟），默认 30"),
  defaultDistanceKm: z.number().min(0).max(500).optional().describe("有氧默认距离（km），默认 5"),
  defaultIncline: z.number().min(0).max(30).optional().describe("有氧默认坡度（%），默认 0"),
  priorityWeight: z.number().optional().describe("项目权重，只允许 0.5、1、1.5、2，默认 1")
};

const exercisePatchFields = Object.fromEntries(
  Object.entries(exerciseFields).map(([key, value]) => [key, value.optional()])
);

const inputShapes = {
  list_fitness_exercises: {},
  get_fitness_day: {
    date: z.string().optional().describe("日期 YYYY-MM-DD，省略时为今天；过去日期只读查看")
  },
  get_fitness_overview: {},
  list_fitness_history: {
    from: z.string().describe("起始日期 YYYY-MM-DD"),
    to: z.string().describe("结束日期 YYYY-MM-DD，跨度最多 400 天")
  },
  create_fitness_exercise: exerciseFields,
  update_fitness_exercise: {
    id: z.number().int().positive().describe("list_fitness_exercises 返回的准确项目 ID"),
    patch: z.object(exercisePatchFields).describe("部分更新对象，只填写确实要修改的字段，至少填写一项；省略的字段保持原值")
  },
  plan_workout_day: {
    date: z.string().describe("要预约的训练日期 YYYY-MM-DD，必须是未来日期")
  },
  unplan_workout_day: {
    date: z.string().describe("要取消预约的训练日期 YYYY-MM-DD，必须是未来日期")
  }
};

const toolSpecs = [
  {
    name: "list_fitness_exercises",
    description: "列出当前账号的健身训练项目，返回准确 ID、无氧/有氧类型、组数、次数、重量、有氧默认时间距离坡度、权重与被选中次数。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "get_fitness_day",
    description: "查看某一天的训练详情：状态（planned/active/completed/none）、当天项目快照、每组完成情况与有氧实际数据。默认今天，过去日期只读。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "get_fitness_overview",
    description: "查看健身概览：今日训练状态、已连续多少天没练、是否该提醒、项目总数与启用项目数。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "list_fitness_history",
    description: "按日期范围查询训练历史摘要（日期、状态、项目数、完成组数）。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "create_fitness_exercise",
    description: "新建一个训练项目。无氧项目填写 sets、reps、weightKg、weightMode；有氧项目填写 defaultDurationMin、defaultDistanceKm、defaultIncline。项目会参与每日按权重随机抽取。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: "update_fitness_exercise",
    description: "按准确 ID 部分更新训练项目。参数格式为 { id, patch }，patch 只填写确实要修改的字段，至少一项；不要把 id 放进 patch。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "plan_workout_day",
    description: "预约未来某一天训练。预约当天仍需要用户自己点「开始训练」才会生成训练项目。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "unplan_workout_day",
    description: "取消未来某一天已有的训练预约。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
].map((tool) => ({ ...tool, inputSchema: inputShapes[tool.name] }));

function jsonParameters(inputSchema) {
  const schema = z.toJSONSchema(z.object(inputSchema));
  delete schema.$schema;
  return schema;
}

const agentToolDefinitions = toolSpecs.map(({ name, description, inputSchema }) => ({
  name,
  description,
  parameters: jsonParameters(inputSchema)
}));

module.exports = { agentToolDefinitions, inputShapes, toolSpecs };

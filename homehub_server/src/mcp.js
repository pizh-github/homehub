"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { toolSpecs: foodToolSpecs } = require("./foodTools");
const { toolSpecs: fitnessToolSpecs } = require("./fitnessTools");

const toolSpecs = [...foodToolSpecs, ...fitnessToolSpecs];

const MCP_INSTRUCTIONS = [
  "小P家事板用于管理当前账号所属家庭的有效期物品，包括食品、药品、保健品和日用品；帮助查询物品放在哪里、临期与过期状态，并维护名称、品类、数量、地点、起始日期、有效天数和到期日。",
  "工具名称为 list_items、get_items、create_items、update_items 和 delete_items。所有工具都只访问令牌所属账号当前家庭的数据。根据用户的明确意图执行新增、修改或删除；信息不足时先询问。",
  "仅食品可以根据常见储存条件保守推断有效天数；药品、保健品等健康相关物品没有明确到期信息时必须追问，绝不猜测有效期，也不提供用药判断。",
  "修改和删除前先通过 list_items 或 get_items 获取准确 ID，绝不臆造 ID。delete_items 是永久删除操作，调用前必须确认用户确实要求删除。",
  "健身相关工具：list_fitness_exercises、create_fitness_exercise、update_fitness_exercise、plan_workout_day、unplan_workout_day、get_fitness_overview、get_fitness_day、list_fitness_history，只访问令牌所属账号自己的训练数据。项目 type 取 anaerobic 或 aerobic，priorityWeight 只允许 0.5、1、1.5、2；预约只能针对未来日期，日期一律 YYYY-MM-DD。开始训练、打卡和结束训练不能通过工具执行。",
  "本 MCP 不管理用户账号、模型配置或墨水屏设备。"
].join("\n");

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function toolError(error) {
  return { content: [{ type: "text", text: error.message || "tool call failed" }], isError: true };
}

function createMcpServer(foodService, user, resolveHouseholdId = (userId) => userId, fitnessService = null) {
  const server = new McpServer(
    { name: "homehub", version: "1.1.0" },
    { instructions: MCP_INSTRUCTIONS }
  );
  const run = (handler) => async (args) => {
    try {
      return toolResult(await handler(args));
    } catch (error) {
      return toolError(error);
    }
  };

  const householdId = resolveHouseholdId(user.id);
  const fitness = (handler) => (args) => {
    if (!fitnessService) throw new Error("fitness tools are not available");
    return handler(fitnessService, args);
  };
  const handlers = {
    list_items: (filters) => foodService.searchFoodItems(householdId, filters),
    get_items: ({ ids }) => ({ items: foodService.getFoodItems(householdId, ids) }),
    create_items: ({ items }) => ({ status: "executed", results: foodService.createFoodItems(householdId, items, { actorUserId: user.id, source: "mcp" }) }),
    update_items: ({ items }) => ({ status: "executed", results: foodService.updateFoodItems(householdId, items, { actorUserId: user.id, source: "mcp" }) }),
    delete_items: ({ ids }) => ({ status: "executed", results: foodService.deleteFoodItems(householdId, ids, { actorUserId: user.id, source: "mcp" }) }),
    list_fitness_exercises: fitness((service) => ({ exercises: service.listExercises(user.id) })),
    get_fitness_day: fitness((service, { date }) => service.getDay(user.id, date || new Date().toISOString().slice(0, 10))),
    get_fitness_overview: fitness((service) => service.getOverview(user.id)),
    list_fitness_history: fitness((service, { from, to }) => ({ items: service.getHistory(user.id, from, to) })),
    create_fitness_exercise: fitness((service, args) => ({ status: "executed", exercise: service.createExercise(user.id, args) })),
    update_fitness_exercise: fitness((service, { id, patch }) => ({ status: "executed", exercise: service.updateExercise(user.id, id, patch) })),
    plan_workout_day: fitness((service, { date }) => ({ status: "executed", ...service.planDay(user.id, date) })),
    unplan_workout_day: fitness((service, { date }) => ({ status: "executed", ...service.unplanDay(user.id, date) }))
  };
  toolSpecs.forEach(({ name, description, inputSchema, annotations }) => {
    server.registerTool(name, { description, inputSchema, annotations }, run(handlers[name]));
  });
  return server;
}

function createMcpHandler({ foodService, fitnessService = null, authenticate, resolveHouseholdId }) {
  return async function handleMcp(req, res) {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = authenticate(token);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(`${JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "invalid or expired access token" }, id: null })}\n`);
      return;
    }
    const server = createMcpServer(foodService, user, resolveHouseholdId, fitnessService);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

module.exports = { createMcpHandler, createMcpServer };

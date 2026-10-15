import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import matter from "gray-matter";
import { employeePatches, skillPatches } from "./market-remediation-content";

// 仅验证修订候选的结构、原文保留和必要约束，不是模型输出或业务验收。
const auditRoot = resolve(__dirname, "../../outputs/market-audit-2026-10-15");
const audit = JSON.parse(
  readFileSync(resolve(auditRoot, "employees.json"), "utf8"),
) as {
  employees: Array<{
    name: string;
    actionCode: string;
    bindings: Array<{ capabilityId: string; capabilityName: string }>;
    evidence: Array<{
      capabilityId: string;
      capabilityName: string;
      artifactFile: string;
    }>;
  }>;
};

const daily = "cmuxhoyck000b7qiizabuq9jh";
const quality = "cmuxhoyd300157qiiobtfn8cl";
const creator = "cmt2lfhi300257qarb8y9umiu";
const visual = "cmt2lfhi300277qaraa5mxn9i";
const douyin = "cmszr2p56005a7qr5xitkx1xw";
const privateDomain = "cmt2lfhhp001s7qarocrkaf4q";
const requiredSkills = {
  [daily]: "电商经营日报",
  [quality]: "电商数据质检",
  [creator]: "Content Creator",
  [visual]: "Visual Storyteller",
  [douyin]: "Douyin Strategist",
  [privateDomain]: "Private Domain Operator",
};

function requireText(content: string, fragments: string[]): void {
  for (const fragment of fragments) expect(content).toContain(fragment);
}

describe("市场审计离线修订候选（静态内容约束，非业务验收）", () => {
  it("只覆盖五项 FIX 和两个明确允许的员工 prompt 护栏", () => {
    const fixEmployees = audit.employees
      .filter((employee) => employee.actionCode === "FIX")
      .map((employee) => employee.name);
    expect(fixEmployees.sort()).toEqual(
      [
        "电商经营日报官",
        "商品内容与详情页策划",
        "抖音运营策略师",
        "私域复购运营师",
        "电商全链路运营顾问",
      ].sort(),
    );
    expect(Object.keys(employeePatches).sort()).toEqual(
      [...fixEmployees, "直播脚本总编", "电商售后与退货专员"].sort(),
    );
    for (const name of ["直播脚本总编", "电商售后与退货专员"]) {
      expect(Object.keys(employeePatches[name])).toEqual(["systemPrompt"]);
    }
    for (const name of fixEmployees) {
      expect(employeePatches[name].description).toBeTruthy();
      expect(employeePatches[name].systemPrompt).toBeTruthy();
    }
  });

  it("技能修订仅含六个既有 capabilityId，不为收窄范围或 CONDITIONAL 扩增版本", () => {
    expect(Object.keys(skillPatches).sort()).toEqual(
      Object.keys(requiredSkills).sort(),
    );
    for (const name of [
      "电商全链路运营顾问",
      "直播脚本总编",
      "电商售后与退货专员",
    ]) {
      const employee = audit.employees.find((entry) => entry.name === name)!;
      for (const binding of employee.bindings) {
        expect(skillPatches).not.toHaveProperty(binding.capabilityId);
      }
    }
  });

  it.each(Object.entries(requiredSkills))(
    "%s 保留完整 frontmatter 和能力原名 %s",
    (id, name) => {
      const employee = audit.employees.find(
        (entry) =>
          entry.actionCode === "FIX" &&
          entry.bindings.some((binding) => binding.capabilityId === id),
      )!;
      const evidence = employee.evidence.find(
        (entry) => entry.capabilityId === id,
      )!;
      const binding = employee.bindings.find(
        (entry) => entry.capabilityId === id,
      )!;
      expect(evidence.capabilityName).toBe(name);
      expect(binding.capabilityName).toBe(name);
      const original = readFileSync(
        resolve(auditRoot, evidence.artifactFile),
        "utf8",
      );
      const originalDocument = matter(original);
      const patch = skillPatches[id];
      const candidate = matter(patch.content);
      expect(candidate.matter).toBe(originalDocument.matter);
      expect(candidate.data).toEqual(originalDocument.data);
      expect(candidate.content).not.toBe(originalDocument.content);
      expect(candidate.content).toContain(name);
      expect(patch.changeSummary.length).toBeGreaterThan(20);
      expect(Object.keys(patch).sort()).toEqual(["changeSummary", "content"]);
    },
  );

  it.each(Object.keys(employeePatches))(
    "%s 不改名，保留执行与数据边界",
    (name) => {
      const patch = employeePatches[name];
      expect(audit.employees.some((entry) => entry.name === name)).toBe(true);
      expect(
        Object.keys(patch).every((key) =>
          ["description", "systemPrompt"].includes(key),
        ),
      ).toBe(true);
      requireText(patch.systemPrompt!, [
        `「${name}」`,
        "不擅自执行",
        "来源",
        "待确认",
        "没有真实工具成功回执",
        "不保证销量、涨粉、转化或收益",
      ]);
      expect(patch.systemPrompt).not.toContain("TITLE");
    },
  );

  it.each([daily, quality])("%s 要求零分母、表文与建议计数复核", (id) => {
    requireText(skillPatches[id].content, [
      "分母为零或缺失",
      "分子为零且分母大于零",
      "合计比率先汇总",
      "未舍入值",
      "最低是拼多多",
      "客单价不可计算",
      "反查最终表格",
      "恰好 N 条",
      "不藏额外行动",
      "不凑数",
      "缺失不是零",
    ]);
  });

  it.each([creator, visual])("%s 将商品事实检查落实到句子和证据", (id) => {
    requireText(skillPatches[id].content, [
      "句子 ID -> 断言 -> 证据 ID",
      "SKU/部位",
      "不能扩写成“304不锈钢内胆”",
      "重量口径未知",
      "车载杯架/背包侧袋适配",
      "轻量不累肩",
      "足够工作日补水",
      "杯盖开合体验或饮品使用限制",
      "必须删除或转入内部待核验清单",
      "没有真实制作回执",
    ]);
  });

  it("抖音删除历史确定性断言并提供待审批测试单", () => {
    const body = matter(skillPatches[douyin].content).content;
    requireText(body, [
      "不能排列成无来源的算法权重优先级",
      "不宣称出镜优于商品镜头固定百分比",
      "不设固定自然触达",
      "预算上限",
      "停止条件",
      "审批人",
      "不实际运行",
      "样本不足",
      "不凭记忆给出“本周热门”",
    ]);
    for (const stale of [
      "Completion rate > like rate",
      "completion rate 30%+ higher",
      "Organic reach per video > 10,000",
      "Run DOU+",
      "TITLE",
    ]) {
      expect(body).not.toContain(stale);
    }
  });

  it("私域频次区分规则、商家配置和假设，缺配置阻止排期", () => {
    requireText(skillPatches[privateDomain].content, [
      "不把“企微群发每月4次、朋友圈每天1次”",
      "来源/日期/适用条件",
      "平台限制、商家策略和实验假设分栏",
      "不生成可直接发送的排期",
      "跨渠道累计触达预算",
      "退出名单",
      "不通过拆群、换号",
    ]);
    expect(skillPatches[privateDomain].content).not.toContain(
      "no more than 4 times per month",
    );
  });

  it("私域 SQL 静态合同含去重、窗口、最新快照与零分母保护，不代表执行通过", () => {
    const content = skillPatches[privateDomain].content;
    const sqlBlocks = [...content.matchAll(/```sql\n([\s\S]*?)\n```/g)];
    expect(sqlBlocks).toHaveLength(1);
    const sql = sqlBlocks[0][1];
    requireText(sql, [
      "PostgreSQL",
      "MIN(add_date)",
      "PARTITION BY user_id ORDER BY acquired_at, channel_code_name",
      "EXISTS (",
      "r.first_reply_time >= c.acquired_at",
      "r.first_reply_time < $2::timestamptz",
      "GROUP BY group_type, member_id",
      "BOOL_OR(has_ordered = 1)",
      "snapshot_at DESC, snapshot_id DESC",
      "snapshot_at <= $3::timestamptz",
      "(snapshot_at::date - first_add_date::date)",
      "observed_days IS NULL OR observed_days < 0",
      "AS invalid_observation_users",
      "WHERE observed_days = 0",
      "SUM(total_gmv) FILTER (WHERE observed_days > 0)",
      "NULLIF(SUM(observed_days) FILTER (WHERE observed_days > 0), 0)",
    ]);
    expect(sql.match(/NULLIF\(/g)).toHaveLength(3);
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i,
    );
    expect(sql).not.toContain("DATEDIFF");
    expect(sql).not.toContain("CURDATE");
    expect(sql).not.toContain("SUM(CASE WHEN first_reply_time");
    requireText(content, [
      "不是预测 LTV",
      "先报错核对",
      "各类型人数不能相加",
      "不是现成业务表",
      "不能直接在 SEP 执行",
      "不代表 SQL 已在真实库执行或指标业务验收通过",
    ]);
  });

  it("全链路只收窄员工范围并定义交接，未冒充补齐能力", () => {
    const patch = employeePatches["电商全链路运营顾问"];
    requireText(patch.description!, [
      "限定提供多平台口径与任务协同",
      "不宣称完成六环节",
    ]);
    requireText(patch.systemPrompt!, [
      "当前仅交付多平台经营协同与内容规划",
      "客服、供应链履约、复购仅输出“待交接项”",
      "建议接收岗位",
      "期望回传",
      "不把交接清单称为完整闭环方案",
    ]);
  });

  it("CONDITIONAL 仅补参数与政策护栏，没有扩展事实或补证前置条件", () => {
    requireText(employeePatches["直播脚本总编"].systemPrompt!, [
      "重量口径未知",
      "杯盖开合体验或饮品使用限制",
      "不以演示镜头暗示已实测",
    ]);
    requireText(employeePatches["电商售后与退货专员"].systemPrompt!, [
      "不因签收仅 1 天就判定仍在售后窗口内",
      "开箱视频只能是可选辅助",
      "没有视频不得据此拒绝",
      "政策明确必需",
    ]);
  });
});

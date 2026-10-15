import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { actionLabels, validateReviews } from './review-validation.mjs';

const directory = new URL('./', import.meta.url);
const root = new URL('../../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const snapshot = await read('snapshot.json');
const verification = await read('verification.json');
const publicCheck = await read('public-market-check.json');
const old = await read('../market-audit-2026-10-14/employees.json');
const drafts = (await Promise.all(['a', 'b', 'c'].map(part => read(`review-${part}.json`)))).flat();
const overrides = await read('review-overrides.json');
assert.equal(drafts.length, snapshot.employees.length, '原始审阅数量不完整');
assert.equal(new Set(drafts.map(review => review.id)).size, drafts.length, '原始审阅重复');
assert.equal(new Set(overrides.map(review => review.name)).size, overrides.length, '主审调整重复');
assert.ok(overrides.every(review => drafts.some(draft => draft.name === review.name)), '主审调整员工不存在');
const byId = new Map(drafts.map(review => [review.id, review]));
const runtime = verification.historicalRuntime.runtime;
const fitLabels = { DIRECT: '国内场景直接匹配', GENERAL_TRANSFER: '通用能力可迁移国内', NEEDS_ADAPTATION: '需收窄/适配国内边界' };
const businessLabels = { UNTESTED: '未实测', FAIL: 'FAIL：当前不可直接交付', CONDITIONAL: 'CONDITIONAL：需审核修正', PASS: 'PASS' };
const count = (rows, key) => rows.reduce((result, row) => {
  result[row[key]] = (result[row[key]] ?? 0) + 1;
  return result;
}, {});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const cell = text => String(text ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' / ');
const write = async (path, value) => writeFile(new URL(path, directory), value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const artifactVersion = binding => snapshot.capabilities.find(item => item.id === binding.capabilityId)
  ?.versions.find(version => version.id === binding.effectivePlatformVersionId);

const rows = snapshot.employees.map((employee, index) => {
  const original = byId.get(employee.id);
  assert.ok(original, employee.name);
  const override = overrides.find(item => item.name === employee.name);
  const review = { ...original, ...(override?.changes ?? {}) };
  const real = runtime.find(item => item.employeeId === employee.id);
  if (real?.business === 'FAIL') review.actionCode = 'FIX';
  if (review.actionCode === 'KEEP' || review.actionCode === 'FIX') review.target = employee.name;
  const bindings = employee.bindings.filter(binding => binding.enabled);
  const mergePlan = review.actionCode === 'MERGE' ? review.target.split('/').map(name => {
    const target = snapshot.employees.find(item => item.name === name.trim());
    assert.ok(target, `${employee.name} 合并目标不存在: ${name}`);
    const targetCapabilities = new Set(target.bindings.filter(binding => binding.enabled).map(binding => binding.capabilityId));
    return { target: target.name, targetId: target.id,
      shared: bindings.filter(binding => targetCapabilities.has(binding.capabilityId)).map(binding => binding.capabilityName),
      toMigrate: bindings.filter(binding => !targetCapabilities.has(binding.capabilityId)).map(binding => ({
        capabilityId: binding.capabilityId, name: binding.capabilityName, versionId: binding.effectivePlatformVersionId,
      })), status: 'PROPOSED_ONLY', gate: '保留源技能和已有订阅；迁移后逐项执行源岗位与目标岗位验收，不是当前已完成' };
  }) : [];
  const sharedRisks = runtime.filter(item => item.employeeId !== employee.id).flatMap(item =>
    item.reads.filter(read => bindings.some(binding => binding.capabilityId === read.capabilityId))
      .map(read => ({ capabilityId: read.capabilityId, employee: item.employee, result: item.business,
        note: '共享技能的风险线索，不是本员工实测结果', issues: item.issues })),
  );
  const evidence = review.evidence.map(item => {
    const binding = bindings.find(binding => binding.capabilityId === item.capabilityId);
    const version = artifactVersion(binding);
    return { ...item, capabilityName: binding.capabilityName, artifactFile: version.artifactFile,
      approvedContentSha256: version.contentSha256, entrySha256: version.descriptor.entrySha256,
      byteLength: version.descriptor.byteLength };
  });
  return { ...employee, ...review, evidence, action: actionLabels[review.actionCode],
    domesticFitLabel: fitLabels[review.domesticFit], businessStatus: real?.business ?? 'UNTESTED',
    technicalStatus: real ? '历史客户端技术链路PASS；本轮静态复核PASS' : '当前上架检查和制品解析PASS；客户端未实测',
    runtimeEvidence: real ?? null, sharedRisks, mergePlan, anchor: `e-${String(index + 1).padStart(3, '0')}`,
    installationChecks: bindings.map(binding => ({ capabilityId: binding.capabilityId, name: binding.capabilityName,
      versionId: binding.effectivePlatformVersionId, descriptor: artifactVersion(binding)?.descriptor })),
    decisionOverride: override ? { rationale: override.rationale, previous: original.actionCode, changes: override.changes } : null,
  };
});
validateReviews(snapshot, rows);
assert.equal(publicCheck.allMatched, true);
assert.equal(verification.passed, snapshot.capabilities.length);
const counts = { KEEP: 0, FIX: 0, MERGE: 0, PAUSE: 0, ...count(rows, 'actionCode') };
const oldCode = action => action.startsWith('保留候选') ? 'KEEP' : action.includes('合并能力') ? 'MERGE' : 'PAUSE';
const changes = rows.flatMap(row => {
  const previous = old.employees.find(employee => employee.id === row.id);
  return oldCode(previous.action) === row.actionCode ? [] : [{ id: row.id, name: row.name,
    previous: oldCode(previous.action), current: row.actionCode, previousReason: previous.reason, currentReason: row.reason }];
});
const summary = { auditedAt: snapshot.capturedAt, generatedAt: new Date().toISOString(),
  environment: snapshot.environment, total: rows.length, archivedCount: snapshot.otherStatusCounts.ARCHIVED,
  counts, domesticFitCounts: count(rows, 'domesticFit'), businessCounts: { PASS: 0, ...count(rows, 'businessStatus') },
  enabledBindings: rows.flatMap(row => row.bindings).filter(binding => binding.enabled).length,
  uniqueCapabilities: snapshot.capabilities.length, staticReady: rows.filter(row => row.readiness === 'READY').length,
  parsedArtifacts: verification.passed, historicalRuntimeTasks: runtime.length, currentReadHashesMatched: verification.historicalRuntime.currentEntryHashesMatched,
  subscriptions: rows.reduce((total, row) => total + row.subscriptions, 0),
  employeesWithSubscriptions: rows.filter(row => row.subscriptions > 0).length,
  publicMarketMatched: publicCheck.allMatched, changedRecommendations: changes.length,
  scope: '本轮全员静态审阅；复用4个已有客户端实测，不是107位全员真机验收',
  sideEffects: '未发布、改名、下架、迁移订阅、操作奖励、部署、提交或推送',
};
await write('employees.json', json({ ...summary, employees: rows }));
await write('decision-diff.json', json({ changed: changes.length, changes }));
await write('summary.json', json(summary));

const columns = ['id', 'name', 'category', 'description', 'subscriptions', 'readiness', 'technicalStatus',
  'domesticFitLabel', 'deliverable', 'requiredInputs', 'dependencies', 'businessStatus', 'action', 'target', 'reason', 'acceptance', 'migrationRequired', 'skills', 'versionIds', 'entryHashes', 'source'];
const escapeCsv = value => `"${String(Array.isArray(value) ? value.join(' / ') : value ?? '').replaceAll('"', '""')}"`;
await write('employees.csv', '\ufeff' + [columns.map(escapeCsv).join(','), ...rows.map(row => {
  const value = { ...row, skills: row.installationChecks.map(check => check.name), versionIds: row.installationChecks.map(check => check.versionId),
    entryHashes: row.installationChecks.map(check => check.descriptor?.entrySha256),
    migrationRequired: row.mergePlan.map(plan => `${plan.target}: ${plan.toMigrate.map(skill => skill.name).join('、') || '绑定已覆盖，仍需验证人设和输出模式'}`),
    source: `逐员工证据.md#${row.anchor}` };
  return columns.map(column => escapeCsv(value[column])).join(',');
})].join('\r\n') + '\r\n');

const skills = snapshot.capabilities.map(capability => {
  const versions = capability.versions.map(version => `版本 ID：\`${version.id}\`；版本号：${version.version}；状态：${version.status}。

- 批准正文 SHA-256：\`${version.contentSha256}\`
- 入口 SHA-256：\`${version.descriptor.entrySha256}\`
- 入口路径：\`${version.descriptor.installationDirectory}/${version.descriptor.entryPath}\`
- 长度：${version.descriptor.byteLength} bytes；文件数：${version.descriptor.fileCount}；格式：${version.descriptor.format}。
- 后端制品：${version.descriptor.status}；客户端原解析器：PASS；名称/正文格式问题：${version.frontmatterIssues.length}。
- [原始制品](${version.artifactFile})

${version.content}`).join('\n\n');
  return `<a id="${capability.id}"></a>\n## ${capability.name}\n\n能力 ID：\`${capability.id}\`；类型：${capability.type}。\n\n${versions}`;
});
await write('正式技能正文与制品.md', `# 正式技能正文与制品证据\n\n采样：${snapshot.capturedAt}。仅本地审计，不是公开市场发布物。正文和批准版本均原样保留，没有改名或改写技能。单文件提示词不代表自带平台接口或执行器；也不排除客户端通用工具可用，须具体任务验证。\n\n${skills.join('\n\n---\n\n')}\n`);

const details = rows.map(row => {
  const skillEvidence = row.evidence.map(item => `- [${item.capabilityName}](正式技能正文与制品.md#${item.capabilityId})；能力 \`${item.capabilityId}\`；版本 \`${item.versionId}\`。原文：“${item.quote}”。入口 SHA-256：\`${item.entrySha256}\`；${item.byteLength} bytes。[制品](${item.artifactFile})。`).join('\n');
  const shared = row.sharedRisks.length ? row.sharedRisks.map(risk => `- 与「${risk.employee}」共享 \`${risk.capabilityId}\`；该岗位已有 ${risk.result}，重点复验：${risk.issues.join('；')}。此结论不能直接转移为本员工 FAIL。`).join('\n') : '- 未关联到四个实测任务的同技能风险；不表示无风险。';
  const actual = row.runtimeEvidence
    ? `[真实记录](${row.runtimeEvidence.evidenceFile})；[交付原文](${row.runtimeEvidence.deliveryFile})；任务 \`${row.runtimeEvidence.taskId}\`；模型 ${row.runtimeEvidence.modelIds.join('、')}。问题：${row.runtimeEvidence.issues.join('；')}。下一步：${row.runtimeEvidence.next}。本轮对实际 read 返回内容做 SHA 核对，绑定的全部 ${row.runtimeEvidence.reads.length} 份技能与当前制品一致。`
    : '没有本员工真实客户端任务记录；UNTESTED，不填写 PASS/FAIL，不从其他岗位表现推断其已通过。';
  return `<a id="${row.anchor}"></a>
## ${row.name}

- 员工 ID：\`${row.id}\`；当前状态：${row.status}；分类：${row.category}；岗位：${row.position}；行业：${row.industry}；模板版本：${row.employeeVersion}。
- 市场描述：${row.description}
- 订阅：${row.subscriptions} 条（全部记录计数，不代表活跃使用或交付质量）；只读快照与公开接口一致。
- 国内适用性：${row.domesticFitLabel}。
- 安装证据：上架检查 ${row.readiness}；每项正式批准版本、制品、路径、SHA 见下；不代表本员工完整客户端对话已通过。
- 当前可尝试交付范围：${row.deliverable}
- 必需输入：${row.requiredInputs.join('；')}。
- 未实证的来源/执行依赖：${row.dependencies.join('；') || '无必须依赖外部账号的文字交付；用户输入真实性和实际质量仍待验收'}。
- 业务结果：${businessLabels[row.businessStatus]}。
- 取舍：**${row.action}**；${row.actionCode === 'MERGE' ? '建议合并目标' : '保留/重评方向'}：${row.target || '补齐下列证据后重评'}。
- 理由：${row.reason}
- 下一项可判定验收：${row.acceptance}

### 逐技能证据

${skillEvidence}

${row.mergePlan.length ? `### 合并前置条件\n\n${row.mergePlan.map(plan => `- 目标：${plan.target}（\`${plan.targetId}\`）；已共享技能：${plan.shared.join('、') || '无同 ID 绑定'}；仍需迁移：${plan.toMigrate.map(skill => `${skill.name}（\`${skill.capabilityId}\`，版本 \`${skill.versionId}\`）`).join('、') || '无新增绑定，但人设与专项产物仍须保留和回归'}。${plan.gate}。`).join('\n')}\n` : ''}

### 人设与执行边界

${row.systemPrompt}

### 实测与风险

${actual}

${shared}
${row.decisionOverride ? `\n主审调整：${row.decisionOverride.rationale}\n` : ''}`;
});
await write('逐员工证据.md', `# 逐员工证据\n\n采样：${snapshot.capturedAt}；107 位在售全覆盖。取舍为审阅建议，不是质量测试结果。本轮不进行模型调用或新客户端会话；有实测证据的仅四位。\n\n${details.join('\n\n---\n\n')}\n`);

const auditPath = '../../outputs/market-audit-2026-10-15/';
const summaryRows = Object.entries(actionLabels).map(([code, label]) => {
  const group = rows.filter(row => row.actionCode === code);
  return `| ${label} | ${group.length} | ${group.reduce((sum, row) => sum + row.subscriptions, 0)} |`;
}).join('\n');
const groupTables = Object.entries(actionLabels).map(([code, label]) => {
  const group = rows.filter(row => row.actionCode === code);
  return `## ${label}（${group.length} 位）\n\n| 员工与逐项证据 | 启用技能 | 可尝试交付 / 合并目标 | 业务实测 | 取舍依据 | 订阅 |\n| --- | --- | --- | --- | --- | --- |\n` + group.map(row => {
    const evidence = `[${row.name}](${auditPath}逐员工证据.md#${row.anchor})`;
    return `| ${evidence} | ${cell(row.installationChecks.map(check => check.name).join('、'))} | ${cell(row.deliverable)}${code === 'MERGE' ? `<br>并入：${cell(row.target)}` : ''} | ${businessLabels[row.businessStatus]} | ${cell(row.reason)} | ${row.subscriptions} |`;
  }).join('\n');
}).join('\n\n');
const runtimeRows = runtime.map(item => `| ${item.employee} | ${item.technical} | ${item.business} | ${item.issues.join('；')} |`).join('\n');
const subscribed = rows.filter(row => ['MERGE', 'PAUSE'].includes(row.actionCode) && row.subscriptions > 0);
const changesTable = changes.map(change => `| ${change.name} | ${actionLabels[change.previous]} | ${actionLabels[change.current]} |`).join('\n');
const priorityFindings = [
  ['电商经营日报官', '本人实测FAIL；表格与文字排序矛盾、零订单客单价写错、建议数量不符'],
  ['商品内容与详情页策划', '本人实测FAIL；新增内胆、适配和使用效果等无依据商品事实'],
  ['抖音运营策略师', '静态审阅；TITLE占位、无来源算法排序和效果指标、执行边界不清'],
  ['私域复购运营师', '静态审阅；无来源平台频次硬限制，SQL粒度、去重和零分母风险'],
  ['电商全链路运营顾问', '静态审阅；宣称覆盖六环节，现有两项技能未定义客服、履约、复购检查点'],
].map(([name, finding]) => {
  const row = rows.find(row => row.name === name);
  assert.equal(row?.actionCode, 'FIX', `优先修复清单与逐员建议冲突: ${name}`);
  return `| [${name}](${auditPath}逐员工证据.md#${row.anchor}) | ${finding} | ${businessLabels[row.businessStatus]} |`;
}).join('\n');
const report = `# 国内电商市场员工逐一核查与取舍清单

日期：2026-10-15；数据库一致性快照：${snapshot.capturedAt}；公开市场接口核对：${publicCheck.checkedAt}。

## 结论

核查本地市场当前 **${rows.length} 位上架员工、${summary.enabledBindings} 个启用绑定、${snapshot.capabilities.length} 个唯一正式技能**，另有 ${summary.archivedCount} 位已归档，不在本轮上架取舍内。不是线上生产环境实况声明。

| 建议 | 员工数 | 涉及订阅记录 |
| --- | --- | --- |
${summaryRows}

国内适用性：${summary.domesticFitCounts.DIRECT ?? 0} 位场景直接匹配，${summary.domesticFitCounts.GENERAL_TRANSFER ?? 0} 位通用方法可迁移国内。**${counts.PAUSE} 位暂时下架，不等于全员已可直接使用**：本轮未发现需要仅因行业不匹配而淘汰的岗位，确定的问题先列修复；${counts.MERGE} 位合并建议针对独立入口重叠，不是删除技能。若全部建议最终通过迁移与验收，可收敛为 ${counts.KEEP + counts.FIX} 个独立入口，而不是现在立即下架 ${counts.MERGE} 位。

**目前没有足够证据推荐任何一位为“无需人工复核、可直接对外使用”。** 107/107 当前上架检查 READY，96/96 正式制品通过真实客户端解析器，只能证明静态可安装。已有真实客户端任务仅 4 位：技术链路 4/4 PASS；业务交付 2 CONDITIONAL、2 FAIL、0 完全通过；其余 103 位 UNTESTED。保留候选是岗位和产物值得继续验收，不是实测 PASS；未实测也不是 FAIL。

最值得先收敛的问题是：日报数字与文字冲突、商品事实扩写、售后政策未知却下结论、直播参数口径被擅自扩写。建议先修复日报与详情页并重新真机验收；直播和售后当前交付只能进入人工审核修正，不直接发布、对客发送或执行订单操作。

## 优先修复

| 员工与证据 | 已发现的问题 | 业务证据状态 |
| --- | --- | --- |
${priorityFindings}

前两位是本人真实任务不通过；后三位是静态内容或范围审阅，不冒充已实测FAIL。直播和售后的CONDITIONAL另按下文原任务条件修正并复验，不计作完全通过。

## 判定口径

1. 逐位读市场描述、systemPrompt、每个启用技能的**当前正式批准正文**；每项绑定至少提供一个原文摘录、版本 ID、入口 SHA、长度和原始制品。员工 ID、分类、输入、产物、外部依赖和独立验收任务在逐项证据中可查。
2. 国内适用性看实际平台场景及输入输出，不看技能名称是中文还是英文。不因中文、空格、中英文混排改名或下架。通用技能也可以用于国内商品、报表和客户材料。
3. 交付文案、脚本、评分表、方案、用户报表分析，本身可以是有效交付；没有店铺接口不是这类岗位的否定证据。但正文写“查询/监测/预测/维护”，不证明实时数据、持续调度、系统写回或精确计算已实测。
4. 同一技能被多个岗位复用，或目标入口覆盖其主要产物，是合并建议的证据；**不同的独有技能仍需保留并实际迁移验证**，并非今天已经合并。不能把一个大岗位名称当作能力覆盖证据，也不能把共享技能的单次失败套成其他员工已 FAIL。
5. 暂停建议针对当前承诺与可核验交付的差距。金融账务、法律/合规、风控及隐私相关产物仅限辅助审阅，不能从提示词和通用模型推导专业正确性；具体待验收项逐位列出。本报告未调查或宣称任何最新平台政策结论。
6. 短模板、英文名、缺实时连接器都不是自动删除标准；本轮没有基于这些单一因素判不合格。所有建议均可在范围收窄、内容修复和证据补齐后调整。

## 安装与旧口径对账

- 当前只读事务调用现有 EmployeeReadinessService.assertReady，并用真实 ClientSkillArtifactService 生成制品；107 位均 READY，96 份正式版本均 AVAILABLE。所有 96 个能力类型为 SKILL，本次制品均是单文件，无 AGENT/RPA/AI_APP 绑定或随包脚本。不能因此断言客户端的通用工具不存在，但不能宣称已有专属店铺接入。
- 当前制品经客户端原 approvedEntry/schema 校验，96/96 PASS。此为内存解析检查，不是 107 位真实安装/对话测试，更不涉及实际店铺账号。
- 昨天旧静态报告的“6 位缺正式版本、6 位正文/名称阻塞”已过时，不再作为本轮下架依据。107 个 ID 与发布后 readiness 清单及当前公开接口全部一致。
- 昨天制品报告中的 105 是“96 份正式制品 + 9 份未发布预览”，不能说成 105 个正式技能。今天只计算 96 份正式版本。
- 已有 4 个客户端任务实际 read 返回的 8 份正文，与今天制品入口 SHA **逐份一致**。以真实返回内容核对，不把任务目录名误当入口 SHA；版本正文的失败并未通过悄悄改技能而消失。

## 真实交付证据

原验收日期为 **2026-10-14**，不是今天新增了 4 次模型调用。使用真实客户端、真实 deepseek-v4.1-flash，经 Gateway → sub2api；测试在隔离克隆库和客户端 profile，不能当作生产环境可用性证明。

| 员工 | 客户端技术 | 本次业务 | 已记录的问题 |
| --- | --- | --- | --- |
${runtimeRows}

[原端到端报告](2026-10-14-客户端国内电商员工端到端验收.md)；[原始业务审阅](${auditPath}../client-ecommerce-e2e-2026-10-14/quality-review.json)；[本次制品及 read 内容对账](${auditPath}verification.json)。重启后四个任务和八个技能记录一致，售后交付在界面重新打开；这是持久化证据，不是另外四次业务验收。

## 下一批验收

1. 日报：复用三渠道样本与零订单渠道，按表逐句核对 ROAS/客单价排名、零分母和建议数量，不能只看任务 completed。
2. 详情页：复用随行杯样本，逐句对照商品证据，禁止把材质推成内胆、把无尺寸资料推成适配、把未经证实功效写成卖点。
3. 直播、售后：先人工修正已有稿，再对“不完整商品参数/未知售后窗口/可选证据与必需证据”做第二任务；通过前不得直接对外使用。
4. 其他保留候选：每位均有可判定任务，按下方逐项证据中的 acceptance 在客户端实际执行；先做运营方案、平台文案、客服草稿，再扩展金额测算与专业初筛。共享上述技能者列入定向回归，仍独立记结果。
5. 实时订单/物流、监控/规则更新、账户操作、知识库写入与媒体成品必须分别取得工具/权限、成功回执和客户端交付证据，不能由纯文本交付替代。电商图片能力另有 [真实接口接入预检](2026-10-15-电商图片员工真实接口接入预检.md)，mock 通过不计作本报告真实媒体交付。

## 市场与订阅保护

本地当前 ${summary.subscriptions} 条订阅记录，分布于 ${summary.employeesWithSubscriptions} 位员工，订阅数不等于活跃使用或交付成功率。建议合并/暂停且已有订阅的员工共 ${subscribed.length} 位：${subscribed.map(row => `${row.name}（${row.subscriptions}）`).join('、') || '无'}。

**本轮未实际下架、改名、发布正式技能、迁移或删除订阅、修改奖励或发放奖励，也未部署、提交 Git 或推送。** “建议收起独立入口”不是删除能力；“建议暂时下架”不是删除已有雇佣关系。后续若执行，需要先核验既有订阅访问语义，目标能力迁移与交付验收通过后再安排入口变更，不将这份报告当作自动批量下架脚本。

## 相对旧建议的修正

共 ${changes.length} 位建议分类变化。主要依据是补齐当前正式版本、重新读取技能及人设边界、纠正“无接口即不能交付分析”的过度推断，以及引入四次真实交付结果。旧建议不是不可改变的基线，所有修正仍需实际业务验收。

| 员工 | 旧建议 | 本轮建议 |
| --- | --- | --- |
${changesTable}

## 证据文件

- [逐员工详细证据](${auditPath}逐员工证据.md)：107 位的 ID、描述、分类、订阅、输入、产物、依赖、原文、人设、业务证据及具体验收任务。
- [CSV 清单](${auditPath}employees.csv)、[完整 JSON](${auditPath}employees.json)、[汇总](${auditPath}summary.json)。
- [只读数据库快照](${auditPath}snapshot.json)、[公开市场逐 ID 核对](${auditPath}public-market-check.json)。快照含内部 systemPrompt，作为内部审计材料，不直接发布到公开市场。
- [正式技能正文与制品索引](${auditPath}正式技能正文与制品.md)、[版本/制品与历史任务核对](${auditPath}verification.json)。
- [逐项建议变化](${auditPath}decision-diff.json)、[主审调整](${auditPath}review-overrides.json)。
- 可复核命令：\`node outputs/market-audit-2026-10-15/verify.mjs\`、\`node outputs/market-audit-2026-10-15/build-report.mjs\`、\`node --test outputs/market-audit-2026-10-15/review-validation.test.mjs\`。重新采样由 capture.mjs 的只读事务执行；采样会更新审计证据，不修改市场状态。

以下逐员表内每个名字都链接到本人的原文、正式版本与验收条件；所有行的当前静态安装检查均已通过，不再重复填写。

${groupTables}
`;
await writeFile(new URL('docs/progress/2026-10-15-国内电商市场员工逐一核查与取舍清单.md', root), report);
const manifestPaths = ['snapshot.json', 'verification.json', 'public-market-check.json', 'employees.json', 'employees.csv',
  'summary.json', 'decision-diff.json', 'review-a.json', 'review-b.json', 'review-c.json', 'review-overrides.json',
  '逐员工证据.md', '正式技能正文与制品.md', 'capture.mjs', 'verify.mjs', 'check-public.mjs', 'build-report.mjs',
  'review-validation.mjs', 'review-validation.test.mjs',
  '../../docs/progress/2026-10-15-国内电商市场员工逐一核查与取舍清单.md'];
await write('evidence-manifest.json', json({ generatedAt: new Date().toISOString(), files: await Promise.all(manifestPaths.map(async path => {
  const bytes = await readFile(new URL(path, directory));
  return { path, sha256: sha256(bytes), byteLength: bytes.length };
})) }));
console.log(json(summary));

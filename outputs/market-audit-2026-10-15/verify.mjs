import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=dirname(fileURLToPath(import.meta.url));
const root=resolve(directory,'../..');
const clientRoot=resolve(root,'../sep-client');
const clientRequire=createRequire(resolve(clientRoot,'package.json'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const ts = clientRequire('typescript');
const cache = new Map();

function loadClient(relative, expose = '') {
  const filename = resolve(clientRoot, relative);
  if (cache.has(filename)) return cache.get(filename);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8') + expose, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const scopedRequire = (id) => {
    if (!id.startsWith('.')) return clientRequire(id);
    if (/\/(?:employee-runtime-contract|skill-artifact-contract|skill-package-parser|skill-package-zip)$/.test(id)) {
      return loadClient(resolve(dirname(filename), `${id}.ts`));
    }
    // Network and persistence functions are not called by the immutable artifact parser.
    return {};
  };
  runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(scopedRequire, module, module.exports);
  return module.exports;
}

const { approvedEntry } = loadClient('electron/pi/sdk/pi-skill-packages.ts', '\nexport { approvedEntry };\n');
const { skillArtifactSchema } = loadClient('electron/common/platform/skill-artifact-contract.ts');
const snapshot=JSON.parse(readFileSync(resolve(directory,'snapshot.json'),'utf8'));
const results=[];
for(const capability of snapshot.capabilities){
  for(const version of capability.versions){
    const artifact=skillArtifactSchema.parse(version.descriptor);
    assert.equal(artifact.status,'AVAILABLE');
    const bytes=readFileSync(resolve(directory,version.artifactFile));
    assert.equal(sha256(version.content),artifact.approvedContentSha256);
    assert.equal(sha256(bytes),artifact.artifactSha256);
    const entry=approvedEntry(bytes,artifact,version.content);
    assert.equal(entry.name,artifact.installationDirectory);
    results.push({capabilityId:capability.id,versionId:version.id,name:capability.name,
      installationDirectory:entry.name,status:'PASS',entrySha256:artifact.entrySha256,byteLength:bytes.length});
  }
}
const e2eDirectory=resolve(root,'outputs/client-ecommerce-e2e-2026-10-14');
const review=JSON.parse(readFileSync(resolve(e2eDirectory,'quality-review.json'),'utf8'));
const runtime=[];
for(const test of review.reviews){
  const employee=snapshot.employees.find(e=>e.name===test.employee);
  assert.ok(employee);
  const raw=JSON.parse(readFileSync(resolve(e2eDirectory,`${test.key}-evidence.json`),'utf8'));
  const starts=new Map(raw.timeline.filter(t=>t.type==='tool_execution_start').map(t=>[t.data.toolId,t.data.input]));
  const reads=[];
  for(const event of raw.timeline.filter(t=>t.type==='message_end'&&t.data.message?.role==='toolResult'&&t.data.message.toolName==='read')){
    const message=event.data.message;
    assert.equal(message.isError,false);
    const input=starts.get(message.toolCallId);
    const capabilityId=input.path.split('/skills/')[1].split('/')[0];
    const binding=employee.bindings.find(b=>b.enabled&&b.capabilityId===capabilityId);
    assert.ok(binding);
    const capability=snapshot.capabilities.find(c=>c.id===capabilityId);
    const version=capability.versions.find(v=>v.id===binding.effectivePlatformVersionId);
    assert.ok(version);
    const text=message.content.map(part=>part.text??'').join('');
    // Compare the actual read return bytes; path directory names need not be the entry hash.
    assert.equal(sha256(text),version.descriptor.entrySha256);
    const end=raw.timeline.find(t=>t.type==='tool_execution_end'&&t.data.toolId===message.toolCallId);
    assert.equal(end?.data.success,true);
    reads.push({capabilityId,versionId:version.id,entrySha256:sha256(text),sameAsCurrentArtifact:true});
  }
  assert.equal(reads.length,employee.bindings.filter(b=>b.enabled).length);
  const delivery=readFileSync(resolve(e2eDirectory,`${test.key}-delivery.md`),'utf8');
  assert.ok(delivery.trim());
  assert.equal(raw.task.status,'completed');
  runtime.push({employeeId:employee.id,employee:employee.name,key:test.key,taskId:raw.task.id,
    technical:test.technical,business:test.business,issues:test.issues,next:test.next,
    modelIds:[...new Set(raw.runs.map(r=>r.modelId))],reads,
    evidenceFile:`../client-ecommerce-e2e-2026-10-14/${test.key}-evidence.json`,
    deliveryFile:`../client-ecommerce-e2e-2026-10-14/${test.key}-delivery.md`,deliveryFileSha256:sha256(delivery)});
}
const old=JSON.parse(readFileSync(resolve(root,'outputs/market-audit-2026-10-14/employees.json'),'utf8'));
const after=JSON.parse(readFileSync(resolve(root,'outputs/skill-validation-audit-2026-10-14/market-readiness-after.json'),'utf8'));
const ids=new Set(snapshot.employees.map(e=>e.id));
const reconciliation={
  previousEmployeeIdsEqual:old.employees.length===ids.size&&old.employees.every(e=>ids.has(e.id)),
  postPublishEmployeeIdsEqual:after.results.length===ids.size&&after.results.every(e=>ids.has(e.id)),
  oldInstallCounts:old.installationCounts,
  currentReadinessCounts:snapshot.employees.reduce((a,e)=>(a[e.readiness]=(a[e.readiness]??0)+1,a),{}),
  currentArtifactCounts:results.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{}),
  note:'旧审计缺批准版及中文/空格名称阻塞已不适用于当前快照；实际技能读取内容的SHA与当前8份制品一致。',
};
assert.equal(reconciliation.previousEmployeeIdsEqual,true);
assert.equal(reconciliation.postPublishEmployeeIdsEqual,true);
const output={verifiedAt:new Date().toISOString(),snapshotAt:snapshot.capturedAt,
  method:'当前只读数据库快照生成真实后端制品，原客户端 approvedEntry + schema 在内存解析；未启动客户端新会话，未发起模型调用',
  parserSource:'../sep-client/electron/pi/sdk/pi-skill-packages.ts',
  approvedArtifacts:results.length,passed:results.filter(r=>r.status==='PASS').length,results,
  historicalRuntime:{scope:'2026-10-14 四岗位每位一个真实任务；本轮仅核对已有证据',tasks:runtime.length,currentEntryHashesMatched:runtime.flatMap(r=>r.reads).length,runtime},reconciliation};
writeFileSync(resolve(directory,'verification.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({artifacts:results.length,passed:output.passed,historicalTasks:runtime.length,readHashesMatched:output.historicalRuntime.currentEntryHashesMatched,reconciliation},null,2));

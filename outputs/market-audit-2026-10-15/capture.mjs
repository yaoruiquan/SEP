import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(`${root}backend/package.json`);
process.loadEnvFile(`${root}backend/.env`);
require('ts-node').register({project:`${root}backend/tsconfig.json`,transpileOnly:true});
require('tsconfig-paths').register({baseUrl:`${root}backend/src`,paths:{shared:['shared']}});
const {PrismaClient}=require('@prisma/client');
const {ConfigService}=require('@nestjs/config');
const {ClientSkillArtifactService}=require(`${root}backend/src/modules/client/client-skill-artifact.service.ts`);
const {SkillPackageService}=require(`${root}backend/src/modules/skill-package/skill-package.service.ts`);
const {EmployeeReadinessService}=require(`${root}backend/src/modules/digital-employee/employee-readiness.service.ts`);
const {parseSkillMarkdown}=require(`${root}backend/src/shared/skill-content.ts`);
const {SkillArtifactFrontmatterSchema}=require(`${root}backend/src/shared/client-skill-artifact.dto.ts`);
const prisma=new PrismaClient();
const artifacts=new ClientSkillArtifactService(null,null,null,new SkillPackageService(new ConfigService()));
const readiness=new EmployeeReadinessService(prisma,artifacts);
const sha256=x=>createHash('sha256').update(x).digest('hex');
const dir=fileURLToPath(new URL('./',import.meta.url));
try {
  const report=await prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows=await tx.digitalEmployee.findMany({
      select: {
        id:true, name:true, description:true, status:true, functionalCategory:true, updatedAt:true, industry:true, position:true, systemPrompt:true, modelId:true, maxSteps:true, version:true,
        _count: {select: {subscriptions:true}},
        bindings: {
          select: {
            id:true, enabled:true, priority:true, defaultSkillVersionId:true, defaultSkillVersion:true,
            capability: {
              select: {
                id:true, name:true, description:true, type:true, status:true,
                agentConfig: {select: {platform:true}},
                skillConfig: {select: {template:true}},
                skillVersions: {
                  where: {scope:'PLATFORM', status:'PLATFORM_APPROVED'},
                  orderBy: [{platformReviewedAt:{sort:'desc',nulls:'last'}},{createdAt:'desc'},{id:'desc'}]
                }
              }
            }
          }
        }
      },
      orderBy: {name:'asc'}
    });
    const live=rows.filter(e=>e.status==='APPROVED');
    const capabilities=new Map();
    const employees=[];
    for(const e of live){
      let ready='READY',diagnostics=null;
      try{await readiness.assertReady(e.id,tx);}catch(error){ready='BLOCKED';diagnostics=error.getResponse?.()??{message:error.message};}
      const bindings=[];
      for(const b of e.bindings){
        const c=b.capability;
        if(!capabilities.has(c.id)){
          const versions=[];
          for(const v of c.skillVersions){
            const prepared=await artifacts.prepare('audit-read-only',c.id,v);
            let nameIssues=[];
            try{const parsed=parseSkillMarkdown(v.content);if(parsed.hasFrontmatter){const result=SkillArtifactFrontmatterSchema.safeParse(parsed.data);if(!result.success)nameIssues=result.error.issues.map(i=>({path:i.path.join('.'),message:i.message}));}}catch(error){nameIssues=[{path:'frontmatter',message:error.message}];}
            if(prepared.buffer)await writeFile(`${dir}artifacts/${v.id}.${prepared.descriptor.format==='zip'?'zip':'md'}`,prepared.buffer);
            versions.push({id:v.id,version:v.version,scope:v.scope,status:v.status,platformReviewedAt:v.platformReviewedAt,content:v.content,contentSha256:sha256(v.content),contentCharacters:v.content.length,packageKey:v.packageKey,packageSha256:v.packageSha256,descriptor:prepared.descriptor,frontmatterIssues:nameIssues,artifactFile:prepared.buffer?`artifacts/${v.id}.${prepared.descriptor.format==='zip'?'zip':'md'}`:null});
          }
          capabilities.set(c.id,{id:c.id,name:c.name,description:c.description,type:c.type,status:c.status,hasAgentConfig:Boolean(c.agentConfig),template:c.skillConfig?.template??null,versions});
        }
        const effective=b.defaultSkillVersionId?c.skillVersions.find(v=>v.id===b.defaultSkillVersionId):c.skillVersions[0];
        bindings.push({id:b.id,enabled:b.enabled,priority:b.priority,capabilityId:c.id,capabilityName:c.name,defaultSkillVersionId:b.defaultSkillVersionId,effectivePlatformVersionId:effective?.id??null});
      }
      employees.push({id:e.id,name:e.name,description:e.description,status:e.status,category:e.functionalCategory,updatedAt:e.updatedAt,industry:e.industry,position:e.position,systemPrompt:e.systemPrompt,modelId:e.modelId,maxSteps:e.maxSteps,employeeVersion:e.version,subscriptions:e._count.subscriptions,readiness:ready,diagnostics,bindings});
    }
    return {capturedAt:new Date().toISOString(),environment:'本地数据库；只读事务；不代表生产市场实况',databaseHost:process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).hostname:null,total:live.length,otherStatusCounts:rows.filter(e=>e.status!=='APPROVED').reduce((a,e)=>(a[e.status]=(a[e.status]??0)+1,a),{}),employees,capabilities:[...capabilities.values()]};
  },{isolationLevel:'RepeatableRead',timeout:120000});
  await writeFile(`${dir}snapshot.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({capturedAt:report.capturedAt,total:report.total,otherStatusCounts:report.otherStatusCounts,readiness:report.employees.reduce((a,e)=>(a[e.readiness]=(a[e.readiness]??0)+1,a),{}),enabledBindings:report.employees.flatMap(e=>e.bindings).filter(b=>b.enabled).length,uniqueCapabilities:report.capabilities.length,versions:report.capabilities.reduce((n,c)=>n+c.versions.length,0),artifacts:report.capabilities.flatMap(c=>c.versions).reduce((a,v)=>(a[v.descriptor.status]=(a[v.descriptor.status]??0)+1,a),{})},null,2));
}finally{await prisma.$disconnect();}

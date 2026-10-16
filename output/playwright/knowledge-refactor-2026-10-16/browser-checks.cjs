async (page) => {
  await page.unroute('**/documents/*/preview*');
  await page.unroute('**/api/knowledge-bases?*');
  await (async (page) => {
  await page.unroute('**/api/**');
  const now = '2026-10-16T01:00:00.000Z';
  const permissions = { canView:true, canSearch:true, canManage:true, canUpload:true, canManageGrants:true };
  const kb = { id:'kb-review', name:'企业制度与产品资料', description:'供企业成员在客户端查询的制度、流程和产品说明。', documentCount:3, readyDocumentCount:1, revision:1, createdAt:now, updatedAt:now, permissions };
  const doc = (id,name,status) => ({id,originalName:name,filename:name,status,fileSize:2048,mimeType:'text/plain',createdAt:now,updatedAt:now,uploader:{id:'admin',name:'企业管理员',email:'admin@example.com'}});
  let docs = [doc('doc-ready','员工报销制度.md','READY'),doc('doc-failed','产品常见问题.txt','FAILED'),doc('doc-pending','新版操作流程.pdf','PROCESSING')];
  let grants = [{id:'grant-1',member:{memberId:'member-1',name:'张三',avatarUrl:null,departmentName:'产品部',position:'产品经理'},grantedAt:now,grantedBy:{memberId:'admin-member',name:'企业管理员'}}];
  const envelope = {items:[kb],page:1,pageSize:20,total:1,viewer:{memberId:'admin-member',enterpriseId:'enterprise-review',role:'ADMIN'},capabilities:{canCreateKnowledgeBase:true,canListGrantCandidates:true},limits:{allowedExtensions:['.pdf','.docx','.txt','.md'],maxFileBytes:10485760,maxFilesPerRequest:1,maxQueryCharacters:1000,maxSearchKnowledgeBases:100,maxTopK:20,maxResultTokens:6000}};
  await page.route('**/api/**',async(route)=>{
    const request=route.request(), u=new URL(request.url()), p=u.pathname, method=request.method();
    const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(data)});
    if(p==='/api/auth/refresh') return send({token:'mock-review-token',user:{id:'admin',email:'admin@example.com',name:'企业管理员',avatar:null,role:'USER'},enterprise:{id:'enterprise-review',name:'知识库验证企业'},roleInEnterprise:'ENTERPRISE_ADMIN'});
    if(p==='/api/enterprise') return send({id:'enterprise-review',name:'知识库验证企业',logo:null});
    if(p==='/api/enterprise/members') return send({items:[{memberId:'member-2',name:'李四',avatarUrl:null,departmentName:'研发部',position:'工程师'}],page:1,pageSize:20,total:1});
    if(p==='/api/knowledge-bases' && method==='GET') return send(envelope);
    if(p==='/api/knowledge-bases/kb-review') return send(kb);
    if(p.endsWith('/documents/status')) return send({total:docs.length,vectorized:1,pending:0,processing:1,ready:1,failed:1,documents:docs.map(d=>({...d,lastError:d.status==='FAILED'?'处理失败，请重试':null,processedAt:null,embeddingModel:null,version:1}))});
    if(p.endsWith('/documents/upload')) {docs.push(doc('doc-uploaded','验收资料.txt','PENDING'));return send(docs[docs.length-1],201);}
    if(p.endsWith('/documents')) return send(docs);
    if(p.endsWith('/preview')) return send({documentId:'doc-ready',documentName:'员工报销制度.md',previewKind:'PROCESSED_CHUNKS',items:[{chunkId:'chunk-review',text:'员工报销须在每月月底前提交发票和审批记录。审批完成后由财务统一处理。'}],page:1,pageSize:20,total:1});
    if(p.endsWith('/reprocess')) {docs=docs.map(d=>d.id==='doc-failed'?{...d,status:'PROCESSING'}:d);return send({message:'Document reprocessing started'},201);}
    if(p.endsWith('/test-search')) return send({query:'报销时间',topK:5,scoreThreshold:.5,strategy:'lexical',hitCount:1,durationMs:8,results:[{chunkId:'chunk-review',content:'员工报销须在每月月底前提交发票和审批记录。',source:'员工报销制度.md',score:.9,knowledgeBaseId:'kb-review',documentId:'doc-ready',documentName:'员工报销制度.md'}]});
    if(p.endsWith('/grants') && method==='POST'){grants.push({id:'grant-2',member:{memberId:'member-2',name:'李四',avatarUrl:null,departmentName:'研发部',position:'工程师'},grantedAt:now,grantedBy:{memberId:'admin-member',name:'企业管理员'}});return send({addedMemberIds:['member-2'],existingMemberIds:[]},201);}
    if(p.endsWith('/grants')) return send({items:grants,page:1,pageSize:20,total:grants.length});
    if(p.includes('/grants/') && method==='DELETE'){grants=grants.filter(g=>g.member.memberId!==p.split('/').pop());return route.fulfill({status:204});}
    if(p.includes('announcements')) return send([]);
    if(p.includes('unread-count')) return send({count:0});
    if(p.includes('notifications')) return send({items:[],total:0,page:1,pageSize:20});
    return send([]);
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://localhost:3000/knowledge');
})(page);
  await page.goto('http://localhost:3000/knowledge/kb-review');
  await page.setViewportSize({width:390,height:844});
  const checks = [];
  const check = (name, pass) => { if (!pass) throw new Error(name); checks.push({name,pass}); };
  const requests = [];
  page.on('request', req => { if(req.url().includes('/knowledge-bases')) requests.push({url:new URL(req.url()).pathname,method:req.method(),body:req.postData()}); });
  await page.getByLabel('选择上传文件').setInputFiles({name:'验收资料.txt',mimeType:'text/plain',buffer:Buffer.from('企业资料测试')});
  await page.getByRole('button',{name:'开始上传'}).click();
  await page.getByText('已上传，等待后台处理').waitFor();
  check('upload_waits_for_processing',true);
  await page.getByRole('tab',{name:'检索验证',exact:true}).click();
  await page.getByRole('textbox',{name:'检索问题'}).fill('报销时间');
  await page.getByRole('button',{name:'验证检索',exact:true}).click();
  await page.getByText('找到 1 条相关内容').waitFor();
  check('search_query_only', requests.some(r=>r.url.endsWith('/test-search') && r.body===JSON.stringify({query:'报销时间'})));
  await page.getByRole('button',{name:'查看文档正文'}).click();
  await page.getByRole('dialog').getByText('员工报销须在每月月底前提交发票和审批记录。审批完成后由财务统一处理。').waitFor();
  check('source_opens_readonly_preview',true);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  check('no_page_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('all_mobile_tabs_in_view',await page.getByRole('tab').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth})));
  await page.screenshot({animations:'disabled',path:'output/playwright/knowledge-refactor-2026-10-16/mobile-search.png'});
  await page.route('**/documents/*/preview*',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'文档尚未就绪，请稍后重试'})}));
  await page.getByRole('button',{name:'查看文档正文'}).click();
  await page.getByRole('dialog').getByText('文档尚未就绪，请稍后重试').waitFor();
  check('preview_409_shows_actionable_error',true);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'基本设置',exact:true}).click();
  await page.getByRole('button',{name:'编辑基本信息'}).waitFor();
  check('basic_settings_available',true);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('tab',{name:'检索验证',exact:true}).click();
  await page.getByRole('textbox',{name:'检索问题'}).fill('报销时间');
  await page.getByRole('button',{name:'验证检索',exact:true}).click();
  await page.getByText('找到 1 条相关内容').waitFor();
  await page.screenshot({path:'output/playwright/knowledge-refactor-2026-10-16/desktop-search.png'});
  await page.route('**/api/knowledge-bases?*',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'禁止访问'})}));
  await page.goto('http://localhost:3000/knowledge');
  await page.getByText('没有知识库管理权限，或企业成员身份已失效。').waitFor();
  check('admin_server_403_denied',true);
  await page.screenshot({path:'output/playwright/knowledge-refactor-2026-10-16/denied-403.png'});
  await page.unroute('**/api/knowledge-bases?*');
  await page.route('**/api/auth/refresh',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'mock-member-token',user:{id:'member-review',name:'普通成员',role:'USER'},enterprise:{id:'enterprise-review',name:'知识库验证企业'},roleInEnterprise:'MEMBER'})}));
  const before = requests.length;
  await page.goto('http://localhost:3000/knowledge');
  await page.getByText('仅企业管理员可管理知识库').waitFor();
  check('ordinary_member_no_knowledge_requests',requests.length===before);
  check('ordinary_member_knowledge_nav_hidden',await page.getByRole('navigation').getByRole('link',{name:'知识库',exact:true}).count()===0);
  return {mode:'mock-api-browser',checks};
}

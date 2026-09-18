# -*- coding: utf-8 -*-
"""构建 64 位硅基员工人设表 -> avatar JSONL + manifest。

覆盖：50 个导入员工 + 6 个电商精选员工 + 8 张备用 = 64。
字段：slug, 中文员工名, 性别(m/f), 年龄, 脸型, 发型, 眼镜/特征, 表情, 服装, 背景组, 侧身方向
"""
import json

P = [
 # ================= 工程开发 (15) =================
 ("fullstack-architect","全栈架构师","m","in his early 40s","a broad rectangular face with a strong jaw","short black hair neatly combed back with faint gray at the temples","no glasses","a calm authoritative expression with a slight smile","a slate-gray unstructured blazer over a black crew-neck shirt and dark trousers","B2","left"),
 ("frontend-engineer","前端工程师","f","in her late 20s","a soft round face","straight black hair in a low ponytail with a few loose strands","thin round glasses","a bright creative half-smile","a coral-cream knit cardigan over a white tee and light trousers","B4","right"),
 ("backend-engineer","后端工程师","m","in his mid 30s","an oval face with calm features","short dark-brown hair with a clean side part","no glasses","a reserved focused expression","a graphite technical shirt-jacket over a gray tee and black trousers","B2","left"),
 ("mobile-engineer","移动端开发","f","in her early 30s","an oval face with soft cheekbones","shoulder-length straight black hair tucked behind one ear","no glasses","an easy confident smile","a navy bomber jacket over a white top and dark trousers","B1","right"),
 ("devops-engineer","DevOps 工程师","m","in his late 30s","an angular face with light stubble","close-cropped black hair with a fade","no glasses","a steady pragmatic expression","a charcoal zip-up work jacket over a heather-gray tee and dark trousers","B2","left"),
 ("dataviz-engineer","数据可视化工程师","f","in her early 30s","a heart-shaped face with defined brows","wavy dark-brown hair at collarbone length with a center part","no glasses","a curious engaged expression","a muted teal blouse under a light gray blazer and dark trousers","B3","right"),
 ("rust-refactor","Rust 重构专家","m","in his mid 30s","a narrow face with sharp cheekbones","medium-length black hair with a soft side sweep","no glasses","an intense but friendly look","a deep rust knit henley under an olive overshirt and dark trousers","B4","left"),
 ("wasm-engineer","WebAssembly 工程师","f","in her mid 20s","a slim oval face","a high ponytail with natural loose strands","thin rectangular glasses","a focused curious smile","a pale-cyan technical jacket over a white shirt and gray trousers","B2","right"),
 ("code-reviewer","代码审查专家","m","in his late 40s","a square face with mild age lines","salt-and-pepper short hair with a neat side part","no glasses","a stern but kind expression","a mid-gray suit jacket over a pale blue shirt and dark trousers","B2","left"),
 ("micro-optimizer","微调优化专家","f","in her late 30s","a round face with soft features","a short dark bob with a side part","no glasses","a thoughtful composed smile","a soft beige blazer over a black top and dark trousers","B4","right"),
 ("api-designer","API 设计师","m","in his early 30s","a slim face with a straight nose","short black hair with a textured quiff","no glasses","a precise friendly expression","a light-gray shirt jacket over a white tee and charcoal trousers","B1","left"),
 ("qa-automation","测试自动化工程师","f","in her mid 30s","an oval face with a rounded chin","medium-length dark hair in a half-up style","thin round glasses","an attentive slight smile","a slate-blue cardigan over a cream blouse and navy trousers","B1","right"),
 ("perf-benchmark","性能基准测试专家","m","in his early 40s","a long angular face","short black hair with a high receding hairline","no glasses","an analytical calm expression","a dark navy technical jacket over a gray shirt and black trousers","B3","left"),
 ("a11y-tester","无障碍测试专家","f","in her late 20s","a soft round face with gentle features","long straight black hair with a center part","no glasses","a warm approachable smile","a pale mint blouse under a light gray cardigan and dark trousers","B3","right"),
 ("game-engineer","游戏开发工程师","m","in his mid 20s","a youthful oval face","medium-length wavy black hair with a relaxed fringe","no glasses","a playful confident grin","an indigo hooded jacket over a white tee and dark trousers","B1","left"),
 # ================= 设计 (8) =================
 ("ux-architect","UX 架构师","f","in her late 30s","a refined oval face with high cheekbones","sleek dark hair in a low chignon","no glasses","a composed insightful expression","a black turtleneck under a stone-gray longline blazer and dark trousers","B2","right"),
 ("ui-designer","UI 设计师","f","in her mid 20s","a bright heart-shaped face","short dark hair with a soft inward curl at the jaw","no glasses","a creative cheerful smile","a lilac knit top under a cream blazer and light trousers","B1","left"),
 ("ux-researcher","UX 研究员","m","in his early 30s","a slim oval face with a small hoop earring","medium-length wavy black hair","no glasses","a curious observant half-smile","a soft plum crew-neck sweater over a white collared shirt and dark trousers","B1","right"),
 ("brand-guardian","品牌守护者","f","in her early 40s","a strong oval face with defined features","shoulder-length dark-brown hair with a subtle wave","no glasses","an assured elegant expression","a deep burgundy blouse under a black tailored blazer and dark trousers","B4","left"),
 ("ai-prompt-engineer","AI 图片提示词工程师","f","in her late 20s","a soft angular face","playful asymmetric dark hair with one side tucked back","no glasses","an imaginative bright expression","an off-white shirt under a sage-green overshirt and dark trousers","B3","right"),
 ("ui-polish-reviewer","UI 完成度审查员","m","in his early 40s","a narrow precise face","neat short black hair with a crisp part","thin rectangular glasses","a detail-focused serious expression","a charcoal merino sweater over a white shirt collar and dark trousers","B2","left"),
 ("delight-injector","趣味注入专家","f","in her mid 20s","a round playful face","bouncy dark curly hair at shoulder length","no glasses","a lively wide smile","a mustard knit sweater vest over a white shirt and dark trousers","B4","right"),
 ("a11y-visual","无障碍视觉专家","f","in her mid 30s","a gentle oval face","dark hair in a braided low bun","thin round glasses","a warm reassuring expression","a muted rose blouse under a soft gray cardigan and navy trousers","B3","left"),
 # ================= 产品 (3) =================
 ("product-manager","产品经理","f","in her early 30s","an oval face with soft definition","shoulder-length softly waved black hair with a side part","no glasses","an alert thoughtful smile","a muted cobalt-blue blazer over a white top and matching trousers","B1","left"),
 ("user-feedback-analyst","用户反馈分析师","m","in his late 20s","an open friendly face","short wavy black hair with a soft fringe","no glasses","an attentive warm expression","a pale blue oxford shirt under a navy cardigan and gray trousers","B2","right"),
 ("product-trend-researcher","产品趋势研究员","f","in her early 30s","a long oval face with refined features","straight dark hair in a mid-height ponytail","no glasses","an analytical curious look","a dove-gray blazer over a black top and dark trousers","B1","left"),
 # ================= 项目 (2) =================
 ("project-manager","项目经理","m","in his late 30s","a square face with a steady jaw","short black hair with a crisp side part","no glasses","an organized confident expression","a navy suit jacket over a white shirt and charcoal trousers","B2","right"),
 ("meeting-notes","会议纪要专家","f","in her mid 20s","a soft round face","dark hair in a neat low ponytail","no glasses","a focused pleasant smile","a pale gray blouse under a soft blue cardigan and dark trousers","B3","left"),
 # ================= 营销增长 (7) =================
 ("douyin-strategist","抖音运营策略师","f","in her late 20s","a bright oval face","long dark hair with a slight wave and a center part","no glasses","an energetic confident smile","a coral blouse under a black-trimmed jacket and dark trousers","B4","right"),
 ("zhihu-strategist","知乎运营策略师","m","in his early 30s","a thoughtful narrow face","medium-length black hair with a relaxed side part","thin round glasses","a wry intelligent expression","a deep blue shirt under a gray knit vest and dark trousers","B2","left"),
 ("cross-border-ecom","跨境电商运营","f","in her mid 30s","a refined oval face with defined brows","sleek shoulder-length dark hair with a side sweep","no glasses","a polished globally-minded smile","a white blouse under a camel blazer and dark trousers","B4","right"),
 ("reddit-community","Reddit 社区运营","m","in his mid 20s","a friendly round face","thick curly dark hair with volume on top","no glasses","a casual warm grin","a faded-forest hoodie over a heather tee and dark trousers","B3","left"),
 ("seo-expert","SEO 优化专家","m","in his mid 30s","a long face with calm features","short dark hair with a neat taper","no glasses","a methodical composed expression","a slate-blue button-down under a charcoal blazer and dark trousers","B2","right"),
 ("podcast-strategist","播客运营策略师","f","in her early 30s","an oval face with warm features","dark hair with an asymmetrical chin-length cut","no glasses","an expressive engaging smile","a rust-orange turtleneck under a brown suede jacket and dark trousers","B4","left"),
 ("multichannel-content","多平台内容分发","f","in her late 20s","a round friendly face","medium-length dark hair in loose waves","no glasses","a brisk cheerful expression","a soft green blouse under a cream overshirt and dark trousers","B3","right"),
 # ================= 销售 (5) =================
 ("sales-coach","销售教练","m","in his late 20s","a broad friendly face","thick softly curled medium-length black hair","no glasses","a warm energetic smile","a burnt-sienna knit polo under a charcoal casual blazer and dark trousers","B4","left"),
 ("sales-proposal","销售提案专家","f","in her mid 30s","a polished oval face","dark hair in a smooth low ponytail","no glasses","a persuasive poised expression","a crisp white shirt under a navy tailored blazer and dark trousers","B2","right"),
 ("enterprise-account","大客户销售","m","in his early 40s","a solid square face with mild lines","short gray-flecked black hair with a side part","no glasses","a trustworthy steady smile","a midnight-navy suit with a pale blue shirt and no tie","B2","left"),
 ("outbound-sales","外呼销售策略师","f","in her late 20s","a bright oval face with expressive eyes","wavy dark hair with lots of natural volume","no glasses","an upbeat persuasive smile","a magenta-rose blouse under a light gray blazer and dark trousers","B4","right"),
 ("sales-engineer","销售工程师","m","in his early 30s","a clean oval face","short neat black hair with a side part","thin rectangular glasses","a technical friendly expression","a pale blue dress shirt under a graphite vest and dark trousers","B1","left"),
 # ================= 安全 (3) =================
 ("security-architect","安全架构师","f","in her late 30s","a long face with defined cheekbones","long straight dark hair tied in a low ponytail","thin round glasses","a serious but approachable expression","a dark forest-green blazer over a black mock-neck top and dark trousers","B3","right"),
 ("key-management","密钥管理专家","m","in his late 30s","an angular face with a clean jaw","short dark hair with a high taper","no glasses","a vigilant composed look","a black technical jacket over a dark gray shirt and black trousers","B2","left"),
 ("threat-intel-analyst","威胁情报分析师","m","in his early 30s","a narrow analytical face with light stubble","medium-length dark hair pushed back","no glasses","an intense focused expression","a dark slate shirt under an olive field jacket and dark trousers","B3","right"),
 # ================= 财务 / 人事 / 法务 / 咨询 / 文档 (8) =================
 ("financial-analyst","财务分析师","f","in her mid 40s","a refined angular face","a neatly styled short dark-brown bob","no glasses","a confident composed expression","a light stone-gray tailored suit over a muted burgundy blouse","B2","right"),
 ("tax-strategist","税务策略师","m","in his early 50s","a dignified long face with faint age lines","short silver-gray hair with a classic side part","no glasses","a measured authoritative expression","a charcoal suit with a crisp white shirt and a muted tie","B2","left"),
 ("recruiter","招聘专家","f","in her early 30s","an open friendly oval face","dark hair in a soft high ponytail","no glasses","a welcoming perceptive smile","a warm peach blouse under a light gray blazer and dark trousers","B4","right"),
 ("legal-reception","法务客户接待","f","in her late 30s","a composed oval face","smooth dark hair in a low twist","no glasses","a calm courteous expression","a white shirt under a dark navy suit jacket and matching trousers","B2","left"),
 ("change-consultant","变革管理顾问","m","in his late 40s","an assured square face","gray-flecked short hair with a soft side sweep","no glasses","a wise encouraging expression","a warm brown blazer over a cream shirt and dark trousers","B4","right"),
 ("doc-generator","文档生成专家","f","in her late 20s","a tidy oval face","a chin-length dark bob with a blunt fringe","no glasses","an orderly efficient smile","a pale gray shirt under a soft navy cardigan and dark trousers","B1","left"),
 ("ap-specialist","应付账款专员","m","in his mid 30s","a plain friendly face","short dark hair with a conservative part","wire-frame glasses","a meticulous mild expression","a white dress shirt under a muted green vest and dark trousers","B3","right"),
 ("spare-supply-chain","供应链分析师","m","in his mid 30s","a compact square face","short black hair with a low fade","no glasses","a practical steady look","a gray utility jacket over a white tee and dark trousers","B2","left"),
 # ================= 电商精选 (6) =================
 ("cn-ecom-operator","国内电商运营专家","f","in her late 20s","a bright oval face","long dark hair with a soft wave and a side part","no glasses","a commercially sharp smile","a cream blouse under a rust-red blazer and dark trousers","B4","left"),
 ("livestream-coach","直播电商增长教练","f","in her early 30s","an animated heart-shaped face","glossy dark hair in a high-volume half-up style","no glasses","a high-energy winning smile","a bright white blazer over a black top and dark trousers","B1","right"),
 ("private-domain-operator","私域复购运营师","f","in her mid 30s","a gentle round face","dark hair in a smooth low bun with a middle part","no glasses","a trustworthy warm expression","a soft rose knit top under a cream cardigan and dark trousers","B4","left"),
 ("ecom-media-buyer","电商投放优化师","m","in his early 30s","a sharp analytical face","short black hair with a clean fade","no glasses","a data-driven focused look","a deep blue shirt under a light gray technical blazer and dark trousers","B2","right"),
 ("product-content-planner","商品内容与详情页策划","f","in her mid 20s","a creative oval face","wavy dark hair with a curtain fringe","no glasses","a stylish inspired smile","a white shirt under a mustard-yellow overshirt and dark trousers","B4","left"),
 ("after-sales-specialist","电商售后与退货专员","m","in his late 20s","a patient rounded face","short tidy black hair with a side part","no glasses","an empathetic calm expression","a pale blue polo under a navy cardigan and dark trousers","B3","right"),
 # ================= 备用 7 张（新增岗位 / 演示账号） =================
 ("spare-data-scientist","数据科学家","f","in her early 30s","a precise oval face with strong brows","straight dark hair in a neat low ponytail","thin rectangular glasses","an analytical clear-eyed expression","a white shirt under a slate-blue blazer and dark trousers","B1","right"),
 ("spare-legal-counsel","法务顾问","m","in his early 40s","a formal rectangular face","short black hair with a rigid side part","no glasses","a serious even expression","a black suit with a white shirt and a muted navy tie","B2","left"),
 ("spare-hr-manager","人力资源经理","f","in her early 40s","a kind oval face","shoulder-length dark hair with a soft flip","no glasses","a reassuring mature smile","a warm beige blazer over a white blouse and dark trousers","B4","right"),
 ("spare-ops-manager","运营经理","f","in her mid 20s","a heart-shaped face","a high ponytail with a few natural loose strands","no glasses","a bright capable expression","a muted olive utility blazer over a cream blouse and matching trousers","B3","left"),
 ("spare-hr-specialist","人事专员","m","in his early 40s","a rounded face","neatly combed salt-and-pepper hair","no glasses","a kind reassuring expression","a warm navy cardigan over a pale blue shirt and dark trousers","B4","right"),
 ("spare-training-lead","培训发展负责人","f","in her late 30s","an expressive oval face","dark hair in a soft wavy shoulder cut","no glasses","an encouraging articulate smile","a plum blouse under a charcoal blazer and dark trousers","B4","right"),
 ("spare-biz-analyst","商业分析师","m","in his late 20s","a crisp angular face","short dark hair with a textured top","thin round glasses","a sharp inquisitive look","a light blue shirt under a dark green knit vest and charcoal trousers","B3","left"),
]

BGS = {
 "B1": "Smooth lavender-to-periwinkle gradient studio background with one large soft diagonal light shape behind the subject.",
 "B2": "Smooth cool blue-gray gradient studio background with one large soft diagonal light shape behind the subject.",
 "B3": "Smooth pale sage-to-mist gradient studio background with one large soft diagonal light shape behind the subject.",
 "B4": "Smooth warm sand-to-soft-apricot gradient studio background with one large soft diagonal light shape behind the subject.",
}
WHO = {"m": "Chinese man", "f": "Chinese woman"}

def build():
    rows, seen = [], set()
    for slug, zh, g, age, face, hair, glasses, expr, outfit, bg, turn in P:
        if slug in seen:
            raise SystemExit("duplicate slug: " + slug)
        seen.add(slug)
        glasses_txt = ("wearing " + glasses) if glasses != "no glasses" else "no glasses"
        # 把耳环等特征并入外貌描述
        if "hoop earring" in face:
            face = face  # 已并入 face 描述
        prompt = (
            "Premium enterprise 3D semi-realistic digital-employee portrait. "
            f"{WHO[g]} {age}, a {zh}. "
            f"{face}, {hair}, {glasses_txt}, {expr}. "
            f"Wearing {outfit}. "
            "FULL UPPER-BODY composition: framed from the top of the head down to the upper thigh, "
            "the whole torso, both shoulders and both arms fully visible, hands relaxed and natural. "
            "The figure fills almost the entire vertical height of the square canvas, standing slightly off-center, "
            f"slight three-quarter turn to the {turn}, eyes looking directly at the camera. "
            f"{BGS[bg]} Soft diffused studio lighting, gentle rim light, "
            "consistent premium corporate digital-employee portrait series. "
            "No props, no laptop, no tablet, no phone, no charts, no documents, no text, no logo, no watermark, "
            "no anime, no cartoon exaggeration."
        )
        rows.append({"slug": slug, "zh": zh, "out": f"{slug}.png", "prompt": prompt})
    return rows

if __name__ == "__main__":
    rows = build()
    assert len(rows) == 64, len(rows)
    with open("/Users/yao/LLM/SEP/tmp/imagegen/silicon-employees-64.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps({"out": r["out"], "prompt": r["prompt"]}, ensure_ascii=False) + "\n")
    json.dump(
        [{"slug": r["slug"], "name": r["zh"], "file": r["out"]} for r in rows],
        open("/Users/yao/LLM/SEP/tmp/imagegen/silicon-employees-64-manifest.json", "w"),
        ensure_ascii=False, indent=2)
    core = [r for r in rows if not r["slug"].startswith("spare-")]
    print("total", len(rows), "core", len(core), "spare", len(rows) - len(core))

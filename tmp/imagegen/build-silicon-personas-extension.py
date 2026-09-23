# -*- coding: utf-8 -*-
"""为生产环境缺失的 24 位员工和 4 位备用人设生成头像提示词。

沿用 build-silicon-personas.py 的构图与背景规范，仅生成 JSONL 和 manifest；
原图由 relay CLI 生成，再用 derive-silicon-webp.py 派生三档素材。
"""
import json
import runpy
from pathlib import Path


PROFILES = [
    ("hr-generalist", "HR 专员", "f", "in her early 30s", "an oval face with bright eyes", "short wavy dark hair tucked behind one ear", "no glasses", "a friendly professional smile", "a muted coral blazer over a cream blouse and charcoal trousers", "B4", "right"),
    ("seo-generalist", "SEO 专员", "m", "in his late 20s", "a slim face with a defined jaw", "short tousled black hair", "thin rectangular glasses", "an attentive analytical expression", "a soft blue overshirt over a white tee and dark trousers", "B2", "left"),
    ("interaction-designer", "交互设计师", "f", "in her mid 30s", "a refined heart-shaped face", "a chin-length dark bob with an asymmetric part", "no glasses", "a thoughtful creative half-smile", "a muted lilac knit top under a charcoal blazer and light trousers", "B1", "right"),
    ("fullstack-developer", "全栈开发工程师", "m", "in his early 30s", "a round face with strong brows", "short curly dark hair", "no glasses", "an open confident smile", "a forest-green casual jacket over a gray crew-neck shirt and navy trousers", "B3", "left"),
    ("content-operator", "内容运营", "f", "in her late 20s", "a soft oval face", "long dark hair in a loose side braid", "no glasses", "an expressive approachable smile", "a terracotta cardigan over a white shirt and dark trousers", "B4", "right"),
    ("frontend-developer", "前端开发工程师", "m", "in his mid 20s", "a lean angular face", "medium-length straight black hair swept to one side", "thin round glasses", "a lively focused expression", "a pale blue hoodie under a navy jacket and black trousers", "B1", "left"),
    ("backend-developer", "后端开发工程师", "f", "in her mid 30s", "a broad oval face with defined cheekbones", "short neatly layered black hair", "no glasses", "a calm assured expression", "a dark teal shirt-jacket over a cream top and charcoal trousers", "B2", "right"),
    ("brand-manager", "品牌经理", "m", "in his early 40s", "a long face with a strong jaw", "neatly cropped black hair with faint gray at the temples", "no glasses", "a poised warm expression", "a sand-colored blazer over a black mock-neck shirt and dark trousers", "B4", "left"),
    ("business-development-manager", "商务拓展经理", "f", "in her late 30s", "a distinctive square face", "shoulder-length dark hair with a soft inward curl", "no glasses", "a persuasive confident smile", "a dark plum suit jacket over a pale blouse and matching trousers", "B1", "right"),
    ("corporate-trainer", "培训师", "m", "in his mid 40s", "a gentle round face", "short salt-and-pepper hair with a side part", "no glasses", "an encouraging articulate expression", "an olive blazer over a white open-collar shirt and navy trousers", "B3", "left"),
    ("growth-hacker", "增长黑客", "f", "in her late 20s", "a narrow face with high cheekbones", "dark hair in a high ponytail", "no glasses", "an energetic inventive grin", "an indigo bomber jacket over a pale mint top and dark trousers", "B1", "right"),
    ("key-account-manager", "大客户经理", "m", "in his late 30s", "a square face with a straight nose", "short black hair with a precise side part", "no glasses", "a reassuring confident smile", "a deep navy tailored jacket over a light blue shirt and charcoal trousers", "B2", "left"),
    ("customer-success-manager", "客户成功经理", "f", "in her early 30s", "a warm oval face with rounded cheeks", "wavy black hair at collarbone length", "no glasses", "a welcoming attentive smile", "a soft sage blazer over a white blouse and light trousers", "B3", "right"),
    ("customer-support-specialist", "客服专员", "m", "in his mid 20s", "a youthful rounded face", "short dark hair with a soft fringe", "no glasses", "a kind patient expression", "a powder-blue cardigan over a white collared shirt and dark trousers", "B2", "left"),
    ("technical-support-engineer", "技术支持工程师", "f", "in her early 40s", "a compact face with strong brows", "dark hair in a neat low bun", "thin rectangular glasses", "a composed helpful expression", "a graphite technical jacket over a pale gray top and dark trousers", "B2", "right"),
    ("data-analyst", "数据分析师", "m", "in his early 30s", "a slim oval face", "close-cropped black hair with a textured top", "thin round glasses", "a curious precise expression", "a cream knit vest over a blue shirt and charcoal trousers", "B3", "left"),
    ("data-engineer", "数据工程师", "f", "in her late 20s", "a heart-shaped face with defined brows", "straight dark hair cut just above the shoulders", "no glasses", "a quietly confident expression", "a dark blue work jacket over a muted lavender shirt and black trousers", "B1", "right"),
    ("test-engineer", "测试工程师", "m", "in his mid 30s", "a broad face with soft features", "short black hair with a subtle fade", "no glasses", "a detail-focused gentle smile", "a steel-gray cardigan over a pale blue shirt and dark trousers", "B2", "left"),
    ("social-media-operator", "社交媒体运营", "f", "in her mid 20s", "a bright round face", "medium-length dark hair with a playful side wave", "no glasses", "a lively natural smile", "a peach-colored blazer over a white crew-neck top and light trousers", "B4", "right"),
    ("mobile-app-developer", "移动端开发工程师", "m", "in his late 20s", "an angular youthful face", "short wavy black hair", "no glasses", "a focused easy smile", "a muted olive overshirt over a black tee and gray trousers", "B3", "left"),
    ("system-architect", "系统架构师", "f", "in her early 40s", "a long oval face with pronounced cheekbones", "sleek black hair pulled back in a low knot", "thin metal-frame glasses", "a strategic composed expression", "a charcoal blazer over a soft blue blouse and black trousers", "B2", "right"),
    ("administrative-assistant", "行政助理", "m", "in his late 20s", "a friendly oval face", "neatly styled short dark hair", "no glasses", "a pleasant organized expression", "a cream button-up shirt under a muted green knit cardigan and navy trousers", "B3", "left"),
    ("sales-representative", "销售代表", "f", "in her early 30s", "a strong heart-shaped face", "long dark hair in a high neat ponytail", "no glasses", "an engaging confident smile", "a rust-red blazer over a white blouse and charcoal trousers", "B4", "right"),
    ("sales-support-specialist", "销售支持专员", "m", "in his mid 30s", "a narrow face with relaxed features", "short dark hair brushed back", "no glasses", "a helpful professional expression", "a dove-gray blazer over a navy open-collar shirt and dark trousers", "B1", "left"),
    ("spare-compliance-analyst", "合规分析师（备用）", "f", "in her late 30s", "a calm square face", "short dark hair with a precise side part", "thin rectangular glasses", "a careful confident expression", "a deep green blazer over a cream blouse and charcoal trousers", "B3", "right"),
    ("spare-customer-insights", "客户洞察顾问（备用）", "m", "in his early 40s", "an open oval face", "short slightly wavy black hair", "no glasses", "an observant warm smile", "a midnight-blue blazer over a soft gray shirt and dark trousers", "B2", "left"),
    ("spare-operations-planner", "运营规划师（备用）", "f", "in her mid 30s", "a slim face with gentle features", "dark hair in a low side ponytail", "no glasses", "a purposeful thoughtful expression", "a muted mustard blouse under a charcoal suit jacket and dark trousers", "B4", "right"),
    ("spare-growth-designer", "增长设计师（备用）", "m", "in his mid 20s", "a round youthful face", "medium-length dark hair with a casual fringe", "no glasses", "a curious creative smile", "a pale lavender shirt-jacket over a black tee and gray trousers", "B1", "left"),
]


def main():
    directory = Path(__file__).resolve().parent
    original = runpy.run_path(str(directory / "build-silicon-personas.py"))
    existing_slugs = {profile[0] for profile in original["P"]}
    extension_slugs = [profile[0] for profile in PROFILES]
    if len(PROFILES) != 28 or len(set(extension_slugs)) != len(extension_slugs) or existing_slugs.intersection(extension_slugs):
        raise SystemExit("头像扩展名单数量错误或 slug 重复")
    rows = original["build"](PROFILES)
    with (directory / "silicon-employees-extension.jsonl").open("w") as output:
        for row in rows:
            output.write(json.dumps({"out": row["out"], "prompt": row["prompt"]}, ensure_ascii=False) + "\n")
    with (directory / "silicon-employees-extension-manifest.json").open("w") as output:
        json.dump([{"slug": row["slug"], "name": row["zh"], "file": row["out"]} for row in rows], output, ensure_ascii=False, indent=2)
    print(f"prepared {len(rows)} personas: 24 production employees, 4 spare")


if __name__ == "__main__":
    main()

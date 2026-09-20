"""Read-only screenshots. Authenticated pages use browser-only fixture responses.
No real credentials, tokens, DB writes, or changes to application auth.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urlparse
import json

OUT = Path('outputs/ui-review')

def fixtures(route, role):
    path = urlparse(route.request.url).path
    user = dict(id='layout-user', email='layout@example.test', name='布局演示', avatar=None, role='ADMIN' if role == 'platform' else 'USER')
    data = {
        '/api/auth/refresh': dict(token='browser-fixture-not-a-real-token', user=user, enterprise=dict(id='layout-enterprise', name='示例科技') if role == 'enterprise' else None, roleInEnterprise='ENTERPRISE_ADMIN' if role == 'enterprise' else None),
        '/api/enterprise/info': dict(id='layout-enterprise', name='示例科技', logo=None, onboardingCompleted=True),
        '/api/dashboard': dict(stats=dict(totalEmployees=12, activeEmployees=10, totalDepartments=3, totalMembers=24, conversations=dict(total=1280, trend=12), computeUsage=dict(total=350, trend=8), balance=500), usageTrend=[], topEmployees=[]),
        '/api/enterprise/dashboard-stats': dict(modelDistribution=[], tokenTrend=[], topMembers=[]),
        '/api/enterprise/my-employees': [],
        '/api/enterprise/departments': [],
        '/api/contributions/mine': [],
        '/api/contributions/rewards': [],
        '/api/admin/stats': dict(kpi=dict(totalEnterprises=24, suspendedEnterprises=0, enterpriseTrendPct=12, totalEmployees=54, pendingEmployees=3, employeeTrendPct=8, pendingCapabilities=5, todayTokens=123456, todayCostCNY=12.34, tokenTrendPct=4, todayActiveUsers=32, userTrendPct=8), computeTrend=[], enterpriseTrend=[], topEnterprises=[], topEmployees=[]),
    }
    if path in data:
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data[path]))
    else:
        route.fulfill(status=503, content_type='application/json', body=json.dumps(dict(message='布局演示：此接口未提供模拟数据')))

with sync_playwright() as p:
    browser = p.chromium.launch()
    checks = []
    for role, routes in [('public', ['/', '/marketplace', '/login']), ('enterprise', ['/dashboard', '/my-employees', '/departments']), ('platform', ['/admin']), ('contributor', ['/contributions'])]:
        for theme in ['light', 'dark']:
            context = browser.new_context()
            context.add_init_script(f"localStorage.setItem('theme', '{theme}')")
            if role != 'public':
                context.route('**/api/**', lambda route, role=role: fixtures(route, role))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            for path in routes:
                for width in [1440, 390]:
                    page.set_viewport_size(dict(width=width, height=900 if width == 1440 else 844))
                    page.goto('http://localhost:3000'+path)
                    page.wait_for_timeout(1800)
                    name = f"after-{role}-{path.strip('/').replace('/', '-') or 'home'}-{theme}-{width}"
                    page.screenshot(path=str(OUT/(name+'.png')))
                    check = dict(name=name, fixture=role != 'public', url=page.url, errors=list(errors), **page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector("h1")?.textContent})'))
                    if path == '/marketplace' and width == 390:
                        page.get_by_role('button', name='筛选', exact=True).click()
                        page.screenshot(path=str(OUT/(name+'-filters.png')))
                        check['filterScroll'] = page.evaluate('document.documentElement.scrollWidth')
                    checks.append(check)
                    errors.clear()
            context.close()
    browser.close()
    (OUT/'layout-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))

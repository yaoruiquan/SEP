from playwright.sync_api import sync_playwright
import json
from pathlib import Path
out=Path('outputs/ui-review')
with sync_playwright() as p:
 browser=p.chromium.launch()
 for role,email in [('enterprise','boss@example.com'),('platform','admin@sep.com')]:
  context=browser.new_context(viewport={'width':1440,'height':1000})
  page=context.new_page()
  page.goto('http://localhost:3000/login'); page.locator('input[type=email]').fill(email); page.locator('input[type=password]').fill('admin123'); page.get_by_role('button',name='登录',exact=True).click()
  page.wait_for_url('**/'+('dashboard' if role=='enterprise' else 'admin'),timeout=20000)
  routes=['dashboard','my-employees','tasks','settings/profile','contributions'] if role=='enterprise' else ['admin','admin/employees','admin/audit']
  checks=[]
  for route in routes:
   page.goto('http://localhost:3000/'+route); page.wait_for_timeout(1600)
   for mobile in [False,True]:
    page.set_viewport_size({'width':390 if mobile else 1440,'height':844 if mobile else 1000}); page.wait_for_timeout(250)
    name=route.replace('/','-')+('-mobile' if mobile else '-desktop')
    page.screenshot(path=str(out/(name+'.png')))
    checks.append({'route':route,'mobile':mobile,'url':page.url,**page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector("h1")?.textContent})')})
  (out/(role+'-checks.json')).write_text(json.dumps(checks,ensure_ascii=False,indent=2))
  context.close()
 browser.close()

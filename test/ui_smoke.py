"""Browser smoke test for the built page: `npm run test:ui` (builds first).

Needs Python Playwright (`pip install playwright && playwright install chromium`); `npm test` does not.
Each test gets a fresh browser context, so localStorage starts empty, and fails on any page error or console error.
"""
import os
import sys
import unittest

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit('Playwright for Python is not installed: pip install playwright && playwright install chromium')

PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'lightpath.html'))
SIZE = {'width': 1440, 'height': 900}


class UI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(PAGE[len('file://'):]):
            raise unittest.SkipTest('dist/lightpath.html is missing: run ./build.sh')
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.errors = []
        self.ctx = self.browser.new_context(viewport=SIZE)
        self.ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        self.page = self.open(self.ctx)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], 'page or console errors')

    def open(self, ctx, url=PAGE):
        pg = ctx.new_page()
        pg.set_default_timeout(5000)
        pg.on('pageerror', lambda e: self.errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and self.errors.append(m.text))
        pg.goto(url)
        pg.wait_for_selector('.node')
        return pg

    # ---------- helpers ----------
    def explore(self, preset=None):
        pg = self.page
        if pg.locator('#welcome').is_visible():
            pg.click('#w-explore')
        if preset:
            pg.select_option('#preset', preset)
            pg.wait_for_timeout(150)

    def status(self):
        return self.page.locator('#status').inner_text()

    def links(self, pg=None):
        return (pg or self.page).evaluate("JSON.parse(localStorage.getItem('lightpath-v1')).links.length")

    def node(self, name):
        return self.page.locator('.node', has_text=name).first

    def handle_drag(self, frm, to):
        pg = self.page
        n = self.node(frm)
        n.hover()
        h = n.locator('.chandle').bounding_box()
        t = self.node(to).bounding_box()
        pg.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2)
        pg.mouse.down()
        pg.mouse.move(t['x'] + t['width'] / 2, t['y'] + t['height'] / 2, steps=6)
        pg.mouse.up()
        pg.wait_for_timeout(150)

    def add(self, kind):
        self.page.locator(f'.pal-item[data-type={kind}]').click()
        return self.page.locator('#f-name').input_value()

    def open_tab(self, group, name):
        self.page.locator('button.tgroup', has_text=group).click()
        self.page.locator('.tab:visible', has_text=name).click()

    # ---------- tests ----------
    def test_first_run_welcome_and_tour(self):
        pg = self.page
        self.assertTrue(pg.locator('#welcome').is_visible())
        pg.click('#w-tour')
        for _ in range(6):
            pg.wait_for_selector('#tour:not([hidden])')
            pg.locator('#tour .btn.primary').click()
        self.assertTrue(pg.locator('#tour').is_hidden())
        pg.reload()
        pg.wait_for_selector('.node')
        self.assertFalse(pg.locator('#welcome').is_visible(), 'the welcome card stays dismissed')

    def test_every_scenario_loads(self):
        self.explore()
        keys = self.page.eval_on_selector_all('#preset option', 'os => os.map(o => o.value).filter(Boolean)')
        self.assertGreater(len(keys), 20)
        for k in keys:
            self.page.select_option('#preset', k)
            self.assertIn(self.status(), {'UP', 'DEGRADED', 'DOWN', 'LOS', 'NO PATH', 'BLOCKED', 'STANDBY'}, k)

    def test_dark_theme_loads(self):
        self.ctx.close()
        self.ctx = self.browser.new_context(viewport=SIZE, color_scheme='dark')
        self.page = self.open(self.ctx)
        self.explore('lh')
        bg = self.page.evaluate("getComputedStyle(document.body).backgroundColor")
        self.assertEqual(bg, 'rgb(12, 19, 17)')

    def test_cable_from_handle_then_fix_with_amplifier(self):
        pg = self.page
        pg.click('#w-blank')
        a, z = self.add('trx'), self.add('trx')
        self.handle_drag(a, z)
        self.assertEqual(self.links(), 1)
        pg.fill('#insp input[type=number]', '120')
        pg.keyboard.press('Tab')
        self.assertEqual(self.status(), 'LOS')
        pg.locator('.link .hit').first.click(button='right', force=True)
        pg.locator('#ctx .mi', has_text='amplifier halfway').click()
        self.assertEqual(pg.locator('.node').count(), 3)

    def test_port_picker_keep_and_cancel(self):
        pg = self.page
        self.explore('roadmports')
        n0 = self.links()
        self.handle_drag(self.add('trx'), 'ROADM-A')
        self.assertTrue(pg.locator('#portpick').is_visible())
        used = pg.eval_on_selector_all('#portpick option', 'os => os.filter(o => o.dataset.used).every(o => o.disabled)')
        self.assertTrue(used, 'ports in use cannot be picked')
        pg.locator('#portpick select').first.select_option(index=6)
        pg.keyboard.press('Enter')
        self.assertEqual(self.links(), n0 + 1)
        pg.click('#btn-undo')
        self.assertEqual(self.links(), n0, 'the cable and its port are one undo step')
        self.handle_drag(self.add('trx'), 'ROADM-B')
        pg.keyboard.press('Escape')
        self.assertTrue(pg.locator('#portpick').is_hidden())
        self.assertEqual(self.links(), n0)

    def test_context_menu_fail_repair_cut(self):
        pg = self.page
        self.explore('dci')
        self.node('PRE-B').click(button='right')
        pg.locator('#ctx .mi', has_text='Fail it').click()
        self.assertEqual(self.status(), 'LOS')
        pg.locator('#toast .toast-act').click()
        self.assertEqual(self.status(), 'UP')
        pg.locator('.link:has(.lbg) .hit').first.click(button='right', force=True)
        pg.locator('#ctx .mi', has_text='Cut this fiber').click()
        self.assertEqual(self.status(), 'LOS')
        pg.keyboard.press('Escape')

    def test_share_link_round_trip(self):
        pg = self.page
        self.explore('mesh')
        self.add('edfa')
        n = pg.locator('.node').count()
        pg.click('#btn-share')
        pg.wait_for_timeout(200)
        url = pg.evaluate('navigator.clipboard.readText()')
        self.assertIn('#lab=', url)
        other = self.browser.new_context(viewport=SIZE)
        try:
            p2 = self.open(other, url)
            p2.wait_for_function(f"document.querySelectorAll('.node').length === {n}")
            self.assertEqual(p2.evaluate('location.hash'), '')
            self.assertFalse(p2.locator('#welcome').is_visible())
        finally:
            other.close()

    def test_bad_share_link_is_refused(self):
        self.page.goto(PAGE + '#lab=notalab')
        self.page.wait_for_function("document.querySelector('#toast').textContent.includes('does not hold a lab')")

    def test_divider_resizes_and_remembers(self):
        pg = self.page
        self.explore()
        h0 = pg.locator('.bench').bounding_box()['height']
        s = pg.locator('#split').bounding_box()
        x, y = s['x'] + s['width'] / 2, s['y'] + s['height'] / 2
        pg.mouse.move(x, y)
        pg.mouse.down()
        pg.mouse.move(x, y - 150, steps=4)
        pg.mouse.up()
        h1 = pg.locator('.bench').bounding_box()['height']
        self.assertAlmostEqual(h1, h0 - 150, delta=2)
        pg.reload()
        pg.wait_for_selector('.node')
        self.assertAlmostEqual(pg.locator('.bench').bounding_box()['height'], h1, delta=2)

    def test_background_channels_are_shown(self):
        pg = self.page
        self.explore('dci')
        self.assertEqual(pg.locator('.lbg').first.text_content(), '+15 background ch')
        self.open_tab('Instruments', 'Spectrum')
        self.assertEqual(pg.locator('.sp-bg').count(), 15)
        self.assertEqual(pg.locator('.sp-me').count(), 1)

    def test_learn_try_it_and_expert_tabs(self):
        pg = self.page
        self.explore('dci')
        pg.locator('button.tgroup', has_text='Analysis').click()
        self.assertEqual(pg.locator('.tab:visible', has_text='Transients').count(), 0, 'expert tabs hidden by default')
        self.open_tab('Learn', 'Learn')
        pg.locator('.lfind').fill('transients')
        pg.locator('.lnav .chip:visible').first.click()
        pg.locator('.tryit .btn.primary').click()
        self.assertEqual(pg.locator('#preset').input_value(), 'mesh')
        self.assertEqual(pg.locator('#btn-expert').get_attribute('aria-pressed'), 'true')
        pg.locator('button.tgroup', has_text='Analysis').click()
        self.assertEqual(pg.locator('.tab:visible', has_text='Transients').count(), 1)

    def test_port_table_is_readable(self):
        pg = self.page
        self.explore('ports')
        self.node('MUX-A').click()
        table = pg.locator('#insp .ptable')
        self.assertGreater(table.bounding_box()['height'], 150, 'the inspector must not squash its scroll boxes')
        self.assertEqual(table.locator('tbody tr').count(), 16)
        table.locator('tr.on').first.click()
        self.assertEqual(pg.locator('#f-name').input_value(), 'TRX-A1')

    def test_port_labels_clear_the_devices(self):
        self.explore()
        for preset in ['reach', 'ports', 'olp', 'odf']:
            self.page.select_option('#preset', preset)
            hits = self.page.evaluate("""(() => { const bodies = [...document.querySelectorAll('.node .body:not(circle)')].map(e => e.getBoundingClientRect()), hit = [];
              for (const t of document.querySelectorAll('.plabel')) { const r = t.getBoundingClientRect();
                if (bodies.some(b => r.left < b.right - 1 && r.right > b.left + 1 && r.top < b.bottom - 1 && r.bottom > b.top + 1)) hit.push(t.textContent); }
              return hit; })()""")
            self.assertEqual(hits, [], preset)

    def test_hover_readout(self):
        pg = self.page
        self.explore('dci')
        self.node('PRE-B').hover()
        tip = pg.locator('#hovtip')
        self.assertTrue(tip.is_visible())
        self.assertIn('OSNR', tip.inner_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)

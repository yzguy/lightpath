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
        return self.page.locator('.node', has=self.page.get_by_text(name, exact=True)).first  # exact: a status tooltip can name other devices

    def handle_drag(self, frm, to):
        """Pick the cable tool the two ends call for (patch or fiber), then drag from one device to the other."""
        pg = self.page
        kind = pg.evaluate("([a, b]) => { const S = JSON.parse(localStorage.getItem('lightpath-v1')), f = n => S.nodes.find(x => x.name === n); return MODEL.cableKind(f(a), f(b)); }", [frm, to])
        pg.click(f'.tool[data-tool="{kind}"]')
        f = self.node(frm).bounding_box()
        t = self.node(to).bounding_box()
        pg.mouse.move(f['x'] + f['width'] / 2, f['y'] + f['height'] / 2)
        pg.mouse.down()
        pg.mouse.move(t['x'] + t['width'] / 2, t['y'] + t['height'] / 2, steps=6)
        pg.mouse.up()
        pg.wait_for_timeout(150)

    def cable(self, frm, to, pa=None, pb=None):
        """Drag a cable from one device to another and pick its ports (by id; default: the first free one at each end)."""
        pg = self.page
        self.handle_drag(frm, to)
        pick = pg.locator('#portpick')
        self.assertTrue(pick.is_visible(), 'the picker asks for the ports')
        for sel, want in zip(pick.locator('select').all(), [pa, pb]):
            sel.select_option(want if want else sel.evaluate("s => [...s.options].find(o => o.value && !o.disabled).value"))
        pick.locator('button', has_text='Connect').click()
        pg.wait_for_timeout(100)
        pg.click('.tool[data-tool="select"]')

    def add(self, kind):
        self.page.locator(f'.pal-item[data-type={kind}]').click()
        return self.page.locator('#f-name').input_value()

    def open_tab(self, group, name):
        self.page.locator('button.tgroup', has_text=group).click()
        self.page.locator('.tab:visible', has_text=name).click()

    def current_tab(self):
        return self.page.locator('.tab[aria-selected=true]').inner_text()

    def cut_fiber(self, i=0):
        self.page.locator('.link.k-fiber .hit').nth(i).click(force=True)  # force: a level line has a zero-height box, which Playwright calls invisible
        self.page.get_by_role('button', name='Cut this fiber').click()

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

    def test_theme_switch_light_dark_system(self):
        self.ctx.close()
        self.ctx = self.browser.new_context(viewport=SIZE, color_scheme='dark')
        pg = self.page = self.open(self.ctx)
        self.explore('lh')
        bg = lambda: pg.evaluate("getComputedStyle(document.body).backgroundColor")
        checked = lambda: pg.locator('#theme-sw [aria-checked=true]').get_attribute('data-theme')
        self.assertEqual(checked(), 'system', 'System is the default')
        self.assertEqual(bg(), 'rgb(12, 19, 17)')
        pg.click('#theme-sw [data-theme=light]')
        self.assertEqual(bg(), 'rgb(233, 238, 236)', 'Light wins over a dark OS')
        pg.reload(); pg.wait_for_selector('.node')
        self.assertEqual(pg.evaluate("document.documentElement.dataset.theme"), 'light', 'remembered across a reload')
        self.assertEqual(checked(), 'light')
        pg.click('#theme-sw [data-theme=system]')
        self.assertEqual(bg(), 'rgb(12, 19, 17)', 'System follows the OS again')
        self.assertIsNone(pg.evaluate("localStorage.getItem('lightpath-theme')"))
        pg.emulate_media(color_scheme='light')
        self.assertEqual(bg(), 'rgb(233, 238, 236)')
        pg.click('#theme-sw [data-theme=dark]')
        self.assertEqual(bg(), 'rgb(12, 19, 17)', 'Dark wins over a light OS')
        pg.focus('#theme-sw [data-theme=dark]'); pg.keyboard.press('ArrowRight')
        self.assertEqual(checked(), 'system', 'arrow keys move along the switch')

    def test_cable_from_handle_then_fix_with_amplifier(self):
        pg = self.page
        pg.click('#w-blank')
        a, z = self.add('trx'), self.add('trx')
        self.cable(a, z, 'L', 'L')
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
        self.assertTrue(pg.locator('#portpick button', has_text='Connect').is_disabled(), 'nothing is picked for you')
        self.assertTrue(pg.eval_on_selector_all('#portpick option', "os => os.filter(o => o.textContent.includes('in use')).every(o => o.disabled)"), 'ports in use cannot be picked')
        sels = pg.locator('#portpick select')
        sels.nth(0).select_option('L')
        sels.nth(1).select_option(sels.nth(1).evaluate("s => [...s.options].find(o => o.value.startsWith('A') && !o.disabled).value"))
        pg.keyboard.press('Enter')
        self.assertEqual(self.links(), n0 + 1)
        pg.click('#btn-undo')
        self.assertEqual(self.links(), n0, 'the cable and its ports are one undo step')
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
        self.assertEqual(pg.locator('.lbg').first.text_content(), '+13 background ch')  # 16 on the line, 3 of them cabled
        self.open_tab('Instruments', 'Spectrum')
        self.assertEqual(pg.locator('.sp-bg').count(), 13)
        self.assertEqual(pg.locator('.sp-me').count(), 1)

    def test_learn_try_it_and_expert_tabs(self):
        pg = self.page
        self.explore('dci')
        pg.locator('button.tgroup', has_text='Analysis').click()
        self.assertEqual(pg.locator('.tab:visible', has_text='Transients').count(), 0, 'expert tabs hidden by default')
        self.open_tab('Learn', 'Topics')
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
        self.assertEqual(table.locator('tbody tr').count(), 18, 'COM, 16 channel ports and the 1310 nm port')
        self.assertIn('COM', table.locator('tbody tr').first.inner_text())
        table.locator('tr.on', has_text='TRX-A1').first.click()
        self.assertEqual(pg.locator('#f-name').input_value(), 'TRX-A1')

    def test_mux_1310_port(self):
        pg = self.page
        self.explore('ports')
        self.node('MUX-A').click()
        self.assertEqual(pg.locator('#f-o1310').count(), 0, 'the optic picker shows only when the port is on')
        pg.select_option('#f-p1310', 'true')
        pg.select_option('#f-o1310', '100g-lr4')
        pg.fill('#f-il1310', '0.8')
        pg.locator('#f-il1310').dispatch_event('input')
        self.assertIn('1310', self.node('MUX-A').text_content())
        self.open_tab('Results', 'Reachability')
        body = pg.locator('#tabbody').inner_text()
        self.assertIn('1310 nm ports', body)
        self.assertIn('BLOCKED', body)  # the booster between the muxes blocks it
        self.assertIn('EDFA', body)

    def test_no_cable_handle_and_hosts_have_no_address(self):
        pg = self.page
        self.explore('reach')
        self.assertEqual(pg.locator('.chandle').count(), 0, 'devices are cabled with the Patch and Fiber tools, not a + handle')
        self.assertNotIn('no address', pg.locator('#cv').text_content())
        self.assertIn('1 × 100G', pg.locator('#cv').text_content())
        self.node('HOST-A1').click()
        self.assertEqual(pg.locator('#f-ip').count(), 0, 'no address field')

    def test_router_cabled_into_1310_port(self):
        pg = self.page
        self.explore('dark')
        a = self.add('mux')
        b = self.add('host')
        self.cable(b, a, 'eth1', '1310')
        self.assertEqual(self.links(), 2)
        pg.locator('.link .hit').last.click(force=True)
        self.assertGreater(pg.locator('#f-optic option').count(), 3)
        pg.select_option('#f-optic', '400g-lr4')
        self.assertEqual(pg.evaluate("JSON.parse(localStorage.getItem('lightpath-v1')).links.find(l => l.p.optic).p.optic"), '400g-lr4')
        self.node(a).click()
        self.assertEqual(pg.locator('#f-p1310').input_value(), 'true', 'cabling a host turns the 1310 nm port on')
        self.assertIn('400GBASE-LR4-10', pg.locator('#insp').inner_text())

    def test_router_1310_link_draws_a_service_line(self):
        pg = self.page
        self.explore('mux1310')
        dwdm = '.lightpath:not(.l1310)'
        self.assertEqual(pg.locator('.lightpath').count(), 0, 'with nothing selected no healthy service draws a moving line')
        self.node('RTR-A').click()
        self.assertEqual(pg.locator('.lightpath.l1310.up').count(), 3, 'router, patch, fiber, patch, router: one moving line per cable')
        self.assertEqual(pg.locator(dwdm).count(), 0, 'selecting a router shows only its own link, not the DWDM service')
        self.node('SW-A').click()
        self.assertEqual(pg.locator('.lightpath.l1310').count(), 0)
        self.assertEqual(pg.locator(dwdm).count(), 3, 'selecting a transponder shows its service')
        pg.locator('.link.k-fiber .hit').first.click(force=True)
        self.assertEqual(pg.locator('.lightpath.l1310.up').count(), 3, 'a selected cable shows every service riding it')
        self.assertEqual(pg.locator(dwdm).count(), 3)
        # cut the fiber: the line turns red up to the cut, and nothing lights the far side
        pg.locator('.link.k-fiber .hit').first.click(force=True)
        pg.get_by_role('button', name='Cut this fiber').click()
        pg.wait_for_timeout(100)
        self.assertEqual(pg.locator('.lightpath.l1310.up').count(), 0)
        self.assertGreater(pg.locator('.lightpath.l1310.down').count(), 0)

    def test_any_port_takes_a_cable_and_a_wrong_one_says_why(self):
        pg = self.page
        pg.click('#w-blank')
        t, m = self.add('trx'), self.add('mux')
        self.cable(t, m, 'L', '1310')
        self.assertTrue(pg.evaluate("MODEL.cablingFaults(JSON.parse(localStorage.getItem('lightpath-v1'))).some(f => /only passes 1310 nm light/.test(f.text))"))
        self.handle_drag(t, m)
        opts = pg.eval_on_selector_all('#portpick select >> nth=0 >> option', 'os => os.map(o => [o.value, o.disabled])')
        self.assertIn(['L', True], opts, 'the line port is taken')
        self.assertIn(['C1', False], opts, 'the client port is free')
        pg.keyboard.press('Escape')

    def test_oadm_line_ports_are_named_by_side(self):
        pg = self.page
        pg.click('#w-blank')
        o, a1, a2 = self.add('oadm'), self.add('edfa'), self.add('edfa')
        self.cable(a1, o, 'OUT', 'LW')
        self.cable(a2, o, 'IN', 'LE')
        self.assertEqual(self.links(), 2)
        labels = sorted(pg.eval_on_selector_all('.plabel', 'ts => ts.map(t => t.textContent)'))
        self.assertIn('Line E', labels)
        self.assertIn('Line W', labels)
        self.node(o).click()
        types = pg.eval_on_selector_all('#f-sides option', 'os => os.map(o => [o.value, o.textContent])')
        self.assertEqual(types, [['ew', 'East and West'], ['w', 'East or West']], 'two OADM types, a single-sided one has its channels on West')

    def test_parallel_cables_do_not_overlap(self):
        """Two cables between the same devices, one drawn each way, sit side by side instead of on top of each other."""
        pg = self.page
        pg.click('#w-blank')
        o, pn = self.add('oadm'), self.add('panel')
        self.cable(pn, o, 'f2', 'LW')
        self.cable(o, pn, 'LE', 'f3')
        self.assertEqual(self.links(), 2)
        mids = pg.eval_on_selector_all('.link .wire', "ws => ws.map(w => [(+w.getAttribute('x1') + +w.getAttribute('x2')) / 2, (+w.getAttribute('y1') + +w.getAttribute('y2')) / 2])")
        self.assertEqual(len(mids), 2)
        (x0, y0), (x1, y1) = mids
        self.assertGreater(((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5, 10, 'the two cables are drawn apart')

    def test_fiber_circuit_name(self):
        """A fiber can be given a circuit name: it is drawn along the span, kept in the saved lab, named in the cut alarm, and clearing it hides it."""
        pg = self.page
        self.explore('dci')
        self.page.locator('.link.k-fiber .hit').first.click(force=True)
        self.assertEqual(pg.locator('.link.k-fiber .lcirc').count(), 0, 'an unnamed fiber has no circuit label')
        pg.fill('#f-circuit', 'SFO2-SCZ1 span A')
        pg.locator('#f-circuit').press('Tab')
        pg.wait_for_timeout(100)
        self.assertEqual(pg.locator('.link.k-fiber .lcirc').first.text_content(), 'SFO2-SCZ1 span A')
        self.assertIn('(SFO2-SCZ1 span A)', pg.locator('.insp-head p.muted').inner_text())
        saved = pg.evaluate("JSON.parse(localStorage.getItem('lightpath-v1')).links.find(l => l.kind === 'fiber').p.circuit")
        self.assertEqual(saved, 'SFO2-SCZ1 span A')
        pg.get_by_role('button', name='Cut this fiber').click()
        pg.wait_for_timeout(100)
        self.assertIn('SFO2-SCZ1 span A', pg.locator('#headline').inner_text(), 'the LOS headline names the circuit')
        pg.fill('#f-circuit', '')
        pg.locator('#f-circuit').press('Tab')
        pg.wait_for_timeout(100)
        self.assertEqual(pg.locator('.link.k-fiber .lcirc').count(), 0, 'clearing the name hides the label')

    def test_fiber_measured_loss_overrides_the_estimate(self):
        pg = self.page
        self.explore('dci')
        pg.locator('.link.k-fiber .hit').first.click(force=True)
        self.assertIn('Estimated', pg.locator('#f-lossinfo').inner_text())
        self.assertTrue(pg.locator('#f-loss-clear').is_hidden(), 'nothing to clear yet')
        est = pg.locator('#f-loss').get_attribute('placeholder')
        margin0 = pg.locator('#headline').inner_text()
        pg.fill('#f-loss', '25')
        pg.wait_for_timeout(100)
        self.assertIn('Using the measured 25.0 dB', pg.locator('#f-lossinfo').inner_text())
        self.assertIn('25.0 dB measured', pg.locator('.link.k-fiber .llabel').first.text_content())
        self.assertIn('(measured)', pg.locator('#spec-loss').inner_text())
        self.assertEqual(pg.evaluate("JSON.parse(localStorage.getItem('lightpath-v1')).links.find(l => l.kind === 'fiber').p.loss"), 25)
        # a new length moves the estimate, the measurement stays
        pg.fill('#f-len', '60')
        pg.wait_for_timeout(100)
        self.assertEqual(pg.locator('#f-loss').input_value(), '25')
        self.assertNotEqual(pg.locator('#f-loss').get_attribute('placeholder'), est)
        self.assertIn('25.0 dB measured', pg.locator('.link.k-fiber .llabel').first.text_content())
        pg.click('#f-loss-clear')
        pg.wait_for_timeout(100)
        self.assertEqual(pg.locator('#f-loss').input_value(), '')
        self.assertIn('Estimated', pg.locator('#f-lossinfo').inner_text())
        self.assertNotIn('measured', pg.locator('.link.k-fiber .llabel').first.text_content())

    def test_oadm_has_a_1310_port_per_side(self):
        pg = self.page
        pg.click('#w-blank')
        o = self.add('oadm')
        self.assertEqual(pg.locator('#f-p1310').input_value(), '', 'off by default')
        pg.select_option('#f-p1310', 'ew')
        stubs = lambda: pg.evaluate("n => [...document.querySelectorAll('.node')].find(g => g.textContent.includes(n)).querySelectorAll('circle.led').length", o)
        self.assertEqual(stubs(), 2, 'a 1310 stub under the W box and one under the E box')
        pg.select_option('#f-p1310', 'w')
        self.assertEqual(stubs(), 1)
        h = self.add('host')
        self.cable(h, o, 'eth1', '1310E')  # the E port is there but not fitted: cabling a router into it fits it
        self.node(o).click()
        self.assertEqual(pg.locator('#f-p1310').input_value(), 'ew')
        self.assertIn('1310 nm E', pg.locator('#insp').inner_text())
        self.assertEqual(stubs(), 2)

    def test_port_labels_clear_the_devices(self):
        self.explore()
        for preset in self.page.evaluate("[...document.querySelectorAll('#preset option')].map(o => o.value).filter(Boolean)"):
            self.page.select_option('#preset', preset)
            hits = self.page.evaluate("""(() => { const ov = (r, b) => r.left < b.right - 1 && r.right > b.left + 1 && r.top < b.bottom - 1 && r.bottom > b.top + 1;
              const bodies = [...document.querySelectorAll('.node .body:not(circle), .nlabel')].map(e => e.getBoundingClientRect()), hit = [];
              const shown = [...document.querySelectorAll('.plabel')].filter(t => t.getAttribute('visibility') !== 'hidden'), R = shown.map(t => t.getBoundingClientRect());
              shown.forEach((t, i) => { if (bodies.some(b => ov(R[i], b)) || R.some((q, j) => j > i && ov(R[i], q))) hit.push(t.textContent); });
              return hit; })()""")
            self.assertEqual(hits, [], preset)

    def test_scenario_intro_and_reset(self):
        pg = self.page
        self.explore()
        card = pg.locator('#labintro')
        self.assertIn('DCI: 400ZR over 80 km', card.inner_text())
        self.assertIn('Try:', card.inner_text())
        self.node('BST-A').click()
        self.assertEqual(card.count(), 0, 'a selection replaces the intro')
        cv = pg.locator('.canvaswrap').bounding_box()
        pg.mouse.click(cv['x'] + 30, cv['y'] + cv['height'] - 30)
        self.assertEqual(card.count(), 1)
        self.explore('mesh')
        self.assertIn('same four slots', card.inner_text())
        card.locator('button', has_text='Read:').click()
        self.assertEqual(self.current_tab(), 'Topics')
        self.assertFalse(pg.locator('#btn-reset').is_visible())
        header_h = pg.locator('header').bounding_box()['height']
        self.cut_fiber()
        self.assertIn('edited', pg.locator('#preset option:checked').inner_text())
        self.assertEqual(pg.locator('header').bounding_box()['height'], header_h, 'the Reset button wrapped the header')
        pg.click('#btn-reset')
        self.assertFalse(pg.locator('#btn-reset').is_visible())
        self.assertNotIn('edited', pg.locator('#preset option:checked').inner_text())
        self.assertEqual(pg.locator('.link.cut').count(), 0)

    def test_channel_summary_and_launch_sweep(self):
        pg = self.page
        self.explore('dci')
        self.assertEqual(pg.locator('#chsum').inner_text(), '3 channels: 3 up')
        pg.click('#chsum')
        self.assertEqual(self.current_tab(), 'Channels')
        self.explore('dark')
        self.assertFalse(pg.locator('#chsum').is_visible())
        self.explore('dci')
        self.open_tab('Analysis', 'Launch sweep')
        use = pg.locator('#tabbody button', has_text='Use ')
        target = use.inner_text().replace('Use ', '').replace(' dBm', '')
        use.click()
        self.assertEqual(pg.locator('#g-launch-v').inner_text(), f'{target} dBm/ch')
        self.assertEqual(pg.locator('#tabbody button', has_text='Use ').count(), 0)

    def test_transponder_lights_show_their_own_line(self):
        pg = self.page
        lights = lambda: pg.evaluate("[...document.querySelectorAll('.node.t-trx .port')].map(l => l.getAttribute('class'))")
        self.explore('dci')
        self.assertEqual(set(lights()), {'port good'})
        for end in ['TRX-A1', 'TRX-B1', 'TRX-A2']:  # every end shows both directions, not just the service's A transmitting and Z receiving
            self.node(end).hover()
            tip = pg.locator('#hovtip').inner_text()
            self.assertIn('Tx power', tip); self.assertIn('Rx power', tip)
        self.cut_fiber()
        self.assertEqual(set(lights()), {'port bad'}, 'every pair on the cut line goes dark, not just the service')
        self.node('TRX-A2').hover()
        self.assertIn('Line los: LOS at TRX-B2: fiber cut', pg.locator('#hovtip').inner_text())
        pg.evaluate("localStorage.clear()")
        pg = self.page = self.open(self.ctx)
        pg.click('#w-blank')
        self.add('trx')
        self.assertEqual(lights(), ['port off'], 'a transponder with no partner is unlit')

    def test_amplifier_is_a_booster_and_preamp_card(self):
        pg = self.page
        self.explore('dci')
        glyphs = lambda name: self.node(name).locator('text.glyph').all_text_contents()
        self.assertEqual(glyphs('BST-A'), ['BST', 'PRE'], 'the A side unit boosts A to Z and pre-amplifies Z to A')
        self.assertEqual(glyphs('PRE-B'), ['PRE', 'BST'])
        self.node('BST-A').hover()
        tip = pg.locator('#hovtip').inner_text()
        self.assertIn('A→Z · Booster', tip); self.assertIn('Z→A · Pre-amp', tip)
        self.node('PRE-B').hover()
        tip = pg.locator('#hovtip').inner_text()
        self.assertIn('A→Z · Pre-amp', tip); self.assertIn('Z→A · Booster', tip)
        self.node('BST-A').click()
        self.assertEqual(pg.eval_on_selector_all('select:has(option[value="ila"]) option', 'os => os.map(o => o.value)'), ['term', 'ila'], 'a booster + pre-amp card, or an in-line amplifier')
        self.assertEqual([h.split()[0] for h in pg.locator('.dirgrid b').all_inner_texts()], ['Booster', 'Pre-amp'])
        pg.locator('#f-targetRev').fill('-3')
        self.node('BST-A').hover()
        self.assertIn('-17.0 → -3.0 dBm/ch', pg.locator('#hovtip').inner_text(), 'the pre-amp column sets the stage the Z to A light goes through')

    def test_palette_fits_with_its_tools(self):
        pg = self.page
        self.explore()
        self.assertEqual(pg.locator('.palgrp').all_inner_texts(), ['ENDPOINTS', 'LINE', 'PASSIVE & CABLING', 'TEST GEAR'])
        pal, tool = pg.locator('.palette').bounding_box(), pg.locator('.tool[data-tool=fiber]').bounding_box()
        self.assertLessEqual(tool['y'] + tool['height'], pal['y'] + pal['height'], 'the cable tools show without scrolling the palette')
        self.assertIn('ZR, ZR+', pg.locator('.pal-item[data-type=trx]').get_attribute('title'))

    def test_starter_lab_names_every_port(self):
        self.explore()
        self.page.select_option('#preset', 'dci')
        shown = self.page.evaluate("[...document.querySelectorAll('.plabel')].filter(t => t.getAttribute('visibility') !== 'hidden').map(t => t.textContent)")
        for name in ['CH45', 'CH46', 'CH47', 'LINE', 'COM']:
            self.assertIn(name, shown)

    def test_box_select_then_drag_the_group(self):
        pg = self.page
        self.explore()
        boxes = sorted(((b['x'] + b['width'] / 2, b['y'] + b['height'] / 2, b) for b in (n.bounding_box() for n in pg.locator('.node').all())), key=lambda c: c[0])
        self.assertGreater(len(boxes), 3)
        left = boxes[:3]
        cut = (boxes[2][0] + boxes[3][0]) / 2
        x0 = min(b['x'] for _, _, b in left) - 12
        y0 = min(b['y'] for _, _, b in left) - 12
        y1 = max(b['y'] + b['height'] for _, _, b in left) + 12
        self.assertEqual(pg.evaluate(f"document.elementFromPoint({x0}, {y0}).closest('.node, .link')"), None, 'the box must start on empty canvas')
        view = pg.evaluate("document.querySelector('#world').getAttribute('transform')")
        pg.mouse.move(x0, y0)  # a plain drag on empty space pans and selects nothing
        pg.mouse.down()
        pg.mouse.move(x0 + 40, y0 + 20, steps=4)
        pg.mouse.up()
        self.assertNotEqual(pg.evaluate("document.querySelector('#world').getAttribute('transform')"), view)
        self.assertEqual(pg.locator('.node.msel, .node.sel').count(), 0)
        pg.mouse.move(x0 + 40, y0 + 20)  # pan it back so the boxes measured above still hold
        pg.mouse.down()
        pg.mouse.move(x0, y0, steps=4)
        pg.mouse.up()
        pg.keyboard.down('Shift')  # Shift + drag draws the box
        pg.mouse.move(x0, y0)
        pg.mouse.down()
        pg.mouse.move(cut, y1, steps=8)
        self.assertEqual(pg.locator('.node.mhit').count(), 3, 'the box previews what it will take')
        pg.mouse.up()
        pg.keyboard.up('Shift')
        self.assertEqual(pg.locator('.node.msel').count(), 3)
        self.assertIn('3 devices selected', pg.locator('#insp').inner_text().lower())
        before = pg.evaluate("Object.fromEntries(JSON.parse(localStorage.getItem('lightpath-v1')).nodes.map(n => [n.id, [n.x, n.y]]))")
        ids = pg.evaluate("[...document.querySelectorAll('.node.msel')].map(g => g.dataset.id)")
        _, _, b = left[0]
        pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
        pg.mouse.down()
        pg.mouse.move(b['x'] + b['width'] / 2 + 60, b['y'] + b['height'] / 2 + 40, steps=6)
        pg.mouse.up()
        pg.wait_for_timeout(100)
        after = pg.evaluate("Object.fromEntries(JSON.parse(localStorage.getItem('lightpath-v1')).nodes.map(n => [n.id, [n.x, n.y]]))")
        moved = {i for i in after if after[i] != before[i]}
        self.assertEqual(moved, set(ids), 'only the selected devices move')
        deltas = {(after[i][0] - before[i][0], after[i][1] - before[i][1]) for i in ids}
        self.assertEqual(len(deltas), 1, 'they move together')
        self.assertEqual(pg.locator('.node.msel').count(), 3, 'still selected after the move')
        # a middle-button drag pans without touching the selection
        view = pg.evaluate("document.querySelector('#world').getAttribute('transform')")
        pg.mouse.move(x0, y0)
        pg.mouse.down(button='middle')
        pg.mouse.move(x0 + 80, y0 + 30, steps=4)
        pg.mouse.up(button='middle')
        self.assertNotEqual(pg.evaluate("document.querySelector('#world').getAttribute('transform')"), view)
        self.assertEqual(pg.locator('.node.msel').count(), 3)
        # Shift-click takes one out, Esc clears
        pg.keyboard.down('Shift')
        self.node(pg.evaluate(f"document.querySelector('.node[data-id=\"{ids[0]}\"] .nlabel').textContent")).click()
        pg.keyboard.up('Shift')
        self.assertEqual(pg.locator('.node.msel').count(), 2)
        pg.keyboard.press('Escape')
        self.assertEqual(pg.locator('.node.sel').count(), 0)

    def test_hover_readout(self):
        pg = self.page
        self.explore('dci')
        self.node('PRE-B').hover()
        tip = pg.locator('#hovtip')
        self.assertTrue(tip.is_visible())
        self.assertIn('OSNR', tip.inner_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const BUILD = process.env.MQTTBOX_TEST_BUILD_DIR || path.join(ROOT, 'build');
const ENDPOINT = 'https://api.github.com/repos/Andy1001Yu/MQTTBox/releases/latest';
const CURRENT = '0.2.2-macos.1';

function releaseResponse(data = { tag_name: 'v0.2.3' }, overrides = {}) {
  return {
    ok: true, status: 200, url: ENDPOINT,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    json: async () => data,
    ...overrides
  };
}

function loadPlatform(response = releaseResponse(), current = CURRENT) {
  const filename = path.join(BUILD, 'platform/common/PlatformUtils.js');
  const realRequire = createRequire(filename);
  const requests = [];
  const notifications = [];
  const opened = [];
  const timeouts = [];
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, URL,
    AbortSignal: { timeout(milliseconds) {
      timeouts.push(milliseconds);
      return AbortSignal.timeout(milliseconds);
    } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return response;
    },
    require(name) {
      if (name === 'electron') return { shell: { openExternal: async url => { opened.push(url); } } };
      if (name === '../../utils/CommonConstants') return { APP_VERSION: current };
      if (name === '../../actions/CommonActions') return { showMessageToUser: data => notifications.push(data) };
      if (name === 'getmac' || name === 'request') throw new Error('Legacy telemetry dependencies must not load');
      return realRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { platform: module.exports.default, requests, notifications, opened, timeouts };
}

test('release check sends an anonymous, bounded HTTPS GET with redirects and credentials disabled', async () => {
  const run = loadPlatform();
  await run.platform.init();
  assert.equal(run.requests.length, 1);
  const { url, options } = run.requests[0];
  assert.equal(url, ENDPOINT);
  assert.equal(new URL(url).search, '');
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.body, undefined);
  assert.deepEqual([...new Headers(options.headers)], [['accept', 'application/vnd.github+json']]);
  assert.deepEqual(run.timeouts, [5000]);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(run.notifications.length, 1);
  assert.match(run.notifications[0].message, /0\.2\.3/);
});

test('release notifications follow semantic version and prerelease precedence', async t => {
  const cases = [
    ['v0.2.2-macos.2', CURRENT, true],
    ['v0.2.2-macos.10', '0.2.2-macos.2', true],
    ['v0.2.2', CURRENT, true],
    ['v0.2.2+build-1', CURRENT, true],
    ['v0.2.2-macos.1+different-build', CURRENT, false],
    ['v0.2.2-macos.1', CURRENT, false],
    ['v0.2.2-macos.0', CURRENT, false],
    ['v0.2.1', CURRENT, false],
    ['v1.0.0', '2.0.0', false],
    ['v2.0.0', '1.0.0', true]
  ];
  for (const [tag, current, notify] of cases) {
    await t.test(`${tag} compared with ${current}`, async () => {
      const run = loadPlatform(releaseResponse({ tag_name: tag }), current);
      await run.platform.init();
      assert.equal(run.notifications.length, notify ? 1 : 0);
    });
  }
});

test('unavailable, redirected, or malformed release responses never notify or escape init', async t => {
  const cases = [
    ['network failure', new TypeError('Failed to fetch')],
    ['timeout', new DOMException('Timed out', 'TimeoutError')],
    ['missing release', releaseResponse({ message: 'Not Found' }, { ok: false, status: 404 })],
    ['rate limit', releaseResponse({ message: 'rate limited' }, { ok: false, status: 403 })],
    ['unexpected status', releaseResponse({ tag_name: 'v9.0.0' }, { status: 201 })],
    ['unexpected response URL', releaseResponse({ tag_name: 'v9.0.0' }, { url: 'https://example.com/releases' })],
    ['HTML response', releaseResponse({ tag_name: 'v9.0.0' }, { headers: new Headers({ 'content-type': 'text/html' }) })],
    ['invalid JSON', releaseResponse(null, { json: async () => { throw new SyntaxError('Invalid JSON'); } })],
    ['null JSON', releaseResponse(null)],
    ['array JSON', releaseResponse([{ tag_name: 'v9.0.0' }])],
    ['missing tag', releaseResponse({ latestVersion: '9.0.0' })],
    ['object tag', releaseResponse({ tag_name: { toString: () => '9.0.0' } })],
    ['script tag', releaseResponse({ tag_name: '<script>alert(1)</script>' })],
    ['newline in tag', releaseResponse({ tag_name: 'v9.0.0\n' })],
    ['partial version', releaseResponse({ tag_name: '9' })],
    ['wildcard version', releaseResponse({ tag_name: '9.x.0' })],
    ['leading zero', releaseResponse({ tag_name: '09.0.0' })],
    ['leading prerelease zero', releaseResponse({ tag_name: '9.0.0-01' })],
    ['huge tag', releaseResponse({ tag_name: `9.0.0-${'a'.repeat(10000)}` })],
    ['draft release', releaseResponse({ tag_name: 'v9.0.0', draft: true })]
  ];
  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const run = loadPlatform(response);
      await assert.doesNotReject(async () => run.platform.init());
      assert.equal(run.notifications.length, 0);
    });
  }
});

test('external links open only HTTP and HTTPS URLs', async () => {
  const run = loadPlatform();
  for (const url of ['https://github.com/Andy1001Yu/MQTTBox/releases', 'http://workswithweb.com/mqttbox.html']) {
    await run.platform.openExternalLink(url);
  }
  assert.deepEqual(run.opened, [
    'https://github.com/Andy1001Yu/MQTTBox/releases', 'http://workswithweb.com/mqttbox.html'
  ]);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'shell:Downloads', 'data:text/html,hello',
    'mailto:someone@example.com', '/Applications/Terminal.app', '', null, {}, 'https://']) {
    await assert.doesNotReject(async () => run.platform.openExternalLink(url));
  }
  assert.equal(run.opened.length, 2, 'untrusted schemes must not reach the OS URL handler');
});

test('displayed version follows the application manifest', () => {
  const version = require(path.join(ROOT, 'package.json')).version;
  const constants = require(path.join(BUILD, 'utils/CommonConstants.js')).default;
  assert.equal(constants.APP_VERSION, version);
});

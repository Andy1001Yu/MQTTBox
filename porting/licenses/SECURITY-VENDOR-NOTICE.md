# Browser assets after the security update

The current MQTTBox browser assets are jQuery 3.7.1, Bootstrap 3.4.1 CSS,
and a custom Bootstrap 3.4.1 JavaScript bundle containing only transition,
collapse, and dropdown. They are stored locally in `src/www/lib` and do not
load these libraries from a CDN at application runtime.

The original `README.md` and `SOURCES.json` in this directory document the
earlier upstream checkout. They remain historical evidence. The current
assets, their exact official version URLs, byte lengths, SHA-256 checksums,
and bundle module offsets are recorded in
[`SECURITY-VENDOR-SOURCES.json`](SECURITY-VENDOR-SOURCES.json).

| Current component | Full license | Treatment |
|---|---|---|
| jQuery 3.7.1 | [Official MIT license](jquery-3.7.1-LICENSE.txt) | Official minified file, byte-preserved |
| Bootstrap 3.4.1 CSS | [Official MIT license](bootstrap-3.4.1-LICENSE.txt) | Official minified file, byte-preserved |
| Bootstrap 3.4.1 JavaScript | [Official MIT license](bootstrap-3.4.1-LICENSE.txt) | Unmodified official transition, collapse, and dropdown source modules, concatenated in that order |

The Bootstrap JavaScript filename remains `bootstrap.min.js` to preserve the
existing local resource path. Its contents are intentionally readable and
are not the upstream complete minified distribution. The bundle consists of
the UTF-8 header in the JSON inventory, then each original module's bytes,
with one additional newline between modules. All module copyright and
license headers remain intact. No excluded plugin is present in this file.
Old jQuery 3.1.0 and complete Bootstrap 3.3.7 JavaScript were replaced at their
existing paths; no extra copy of those scripts is shipped beside the update.

The existing normalize.css 3.0.3 license still applies to the code embedded
in Bootstrap CSS. The Glyphicons font files were not changed, and retain
their existing font metadata and notice. Older component license files are
retained for the original checkout's provenance, not as a claim that the
old scripts are still deployed.

## Component selection and security scope

The app uses Bootstrap's collapse and dropdown data APIs. Collapse also
requires transition. A static tooltip attribute on the client ID button
does not initialize the optional tooltip plugin; its fixed native `title`
remains available. No direct plugin calls or data APIs requiring alert,
button, carousel, modal, popover, scrollspy, tab, or affix were found in the
application source. The custom bundle excludes those plugins and tooltip.

Bootstrap 3.4.0 fixed older XSS issues in collapse, dropdown, and other
components. Bootstrap 3.4.1 added tooltip/popover sanitization, but Bootstrap
3 is end of life and the full 3.4.1 distribution still has reported issues
in unused plugins, including CVE-2025-1647 in tooltip/popover. Selecting the
modules the app uses avoids shipping that unused implementation. It does
not establish that the complete application or every asset is free of
vulnerabilities. `npm audit` does not inspect these vendored browser files.

If another Bootstrap plugin is added later, review its current security
status and dependencies before extending this bundle.

## Verification

The inventory permits checking every installed file's size and SHA-256,
and the exact source bytes of each bundled module using its recorded
offset. JavaScript syntax can be checked with `node --check` on both local
scripts. Browser checks should verify jQuery version 3.7.1 and collapse /
dropdown version 3.4.1, open and close the Menu, and collapse and expand an
actual MQTT message panel. Optional tooltip, popover, and button plugins
should remain undefined. Existing end-to-end MQTT/UI tests cover the menu
and message panel interactions; rerun them against the rebuilt app.

## Primary references

- [Official jQuery 3.4.0 prototype pollution fix](https://blog.jquery.com/2019/04/10/jquery-3-4-0-released/)
- [Official jQuery 3.5.0 HTML processing security fix](https://blog.jquery.com/2020/04/10/jquery-3-5-0-released/)
- [Official jQuery 3.7.1 release and downloads](https://blog.jquery.com/2023/08/28/jquery-3-7-1-released-reliable-table-row-dimensions/)
- [Official Bootstrap 3.4.0 security fixes](https://blog.getbootstrap.com/2018/12/13/bootstrap-3-4-0/)
- [Official Bootstrap 3.4.1 security release](https://blog.getbootstrap.com/2019/02/13/bootstrap-4-3-1-and-3-4-1/)
- [Official Bootstrap module dependencies and optional tooltip initialization](https://getbootstrap.com/docs/3.4/javascript/)
- [CVE-2025-1647 details from the reporting vendor](https://www.herodevs.com/vulnerability-directory/cve-2025-1647)

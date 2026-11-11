# Current security-updated browser assets

For release 0.2.2-macos.1, see [SECURITY-VENDOR-NOTICE.md](SECURITY-VENDOR-NOTICE.md) and [SECURITY-VENDOR-SOURCES.json](SECURITY-VENDOR-SOURCES.json): jQuery 3.7.1 and the selected Bootstrap 3.4.1 modules/CSS replace the earlier scripts. Historical notices below remain for provenance.

# MQTTBox port: licenses and notices

These materials were added during the macOS port. They supplement the notices in
the original checkout. They are not original MQTTBox license files and do not
grant or expand rights beyond the upstream declarations. Third-party components
retain their own licenses.

The audited MQTTBox source is `workswithweb/MQTTBox`, `electron_app`, commit
`6422e4039264183c7cd576b622e567a2d8ab942f`. Its application manifest declares MIT
and records `© 2016, Workswithweb inc.`. The original repository does not provide a
standalone project-wide LICENSE file. The supplement below records that fact and
the standard terms named by the manifest; it does not resolve the scope of the
declaration for other branches, build tools, logos or trademarks.

| Component | Notice / full text | Origin of this file |
|---|---|---|
| MQTTBox desktop application | [Manifest and MIT supplement](MQTTBox-manifest-MIT-supplement.txt) | Assembled during porting from the original manifest and standard MIT terms |
| Bootstrap 3.3.7 | [MIT LICENSE](bootstrap-3.3.7-LICENSE.txt) | Unmodified official v3.3.7 LICENSE |
| normalize.css 3.0.3 embedded in Bootstrap CSS | [MIT LICENSE](normalize-3.0.3-LICENSE.txt) | Unmodified official 3.0.3 LICENSE.md |
| jQuery 3.1.0 | [MIT LICENSE](jquery-3.1.0-LICENSE.txt) | Unmodified official 3.1.0 LICENSE.txt |
| Font Awesome 4.6.3 CSS | [MIT supplement and original attribution](font-awesome-4.6.3-CSS-MIT-supplement.txt) | Versioned declaration plus standard MIT permission/disclaimer |
| Font Awesome 4.6.3 fonts | [OFL 1.1 supplement and original copyright](font-awesome-4.6.3-font-OFL-supplement.txt) | Versioned declaration, embedded font copyright and complete standard OFL text |
| Font Awesome 4.6.3 brand icons | [Brand notice](font-awesome-4.6.3-BRAND-NOTICE.txt) | Upstream notice with HTML list markup removed |
| Bootstrap bundled Glyphicons Halflings | [Font notice](bootstrap-3.3.7-GLYPHICONS-NOTICE.txt) | Embedded font copyright and source of upstream usage statement |
| FixedDataTable 0.6.3 | [BSD LICENSE](fixed-data-table-0.6.3-LICENSE.txt), [PATENTS](fixed-data-table-0.6.3-PATENTS.txt) | Unmodified official v0.6.3 files |

[SOURCES.json](SOURCES.json) records source URLs, exact versions, file kinds,
byte lengths and SHA-256 checksums. The complete standard [MIT text](MIT-standard-reference.txt)
and [OFL 1.1 text](OFL-1.1-standard-reference.txt) come from a pinned commit of the
official SPDX license database. The generic MIT file intentionally retains its
template copyright placeholders; component-specific notices provide the actual
attribution found upstream. The assembled supplements label their provenance.

Font Awesome's versioned [license declaration](https://github.com/FortAwesome/Font-Awesome/blob/v4.6.3/README.md#license)
distinguishes the MIT CSS from the OFL fonts. The font copyright is
`Copyright Dave Gandy 2016. All rights reserved.` The bundled FontAwesome.otf was
verified byte-for-byte against the official v4.6.3 file. Glyphicons Halflings
records `Copyright © 2014 by Jan Kovarik. All rights reserved.`; its upstream
statement is linked in the separate notice.

Preserve this directory and the original copyright headers/font metadata when
redistributing the bundled resources. Preserve the separate license files
provided by packaged npm and Electron dependencies as well; this directory is
not a complete license inventory of all transitive dependencies. FixedDataTable's
PATENTS text is a separate additional grant with termination provisions.

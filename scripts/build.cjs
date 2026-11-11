// Preserve the upstream README's separate CommonJS/JSX compilation.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
fs.rmSync(path.join(root, 'build'), {recursive: true, force: true});
const result = spawnSync(process.execPath, [require.resolve('@babel/cli/bin/babel.js'), 'src/app', '--out-dir', 'build'], {cwd: root, stdio: 'inherit'});
if (result.status !== 0) process.exit(result.status || 1);
fs.cpSync(path.join(root, 'src/www'), path.join(root, 'build'), {recursive: true});

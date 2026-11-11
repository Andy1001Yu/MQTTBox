#!/usr/bin/env python3
"""Check the built apps, mount DMGs read-only, and record release checksums."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    print('$', ' '.join(map(str, args)), flush=True)
    print(result.stdout + result.stderr, flush=True)
    result.check_returncode()
    return result.stdout + result.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', nargs='+', choices=['arm64', 'x64'], default=['arm64', 'x64'])
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / 'package.json').read_text())['version']
    records = []
    for arch in args.arch:
        folder = 'mac-arm64' if arch == 'arm64' else 'mac'
        app = root / 'dist' / folder / 'MQTTBox.app'
        dmg = root / 'dist' / f'MQTTBox-{version}-mac-{arch}.dmg'
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        if info['CFBundleShortVersionString'] != version:
            raise RuntimeError(f'App version mismatch: {arch}')
        executable = app / 'Contents/MacOS/MQTTBox'
        architecture = run('file', str(executable))
        if ('arm64' if arch == 'arm64' else 'x86_64') not in architecture:
            raise RuntimeError(f'Executable architecture mismatch: {arch}')
        run('codesign', '--verify', '--deep', '--strict', '--verbose=1', str(app))
        signing = run('codesign', '-dv', str(app))
        run('hdiutil', 'verify', str(dmg))
        mount = Path(tempfile.mkdtemp(prefix=f'mqttbox-dmg-{arch}-'))
        attached = False
        try:
            run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(dmg))
            attached = True
            for relative in ['Contents/MacOS/MQTTBox', 'Contents/Resources/app.asar']:
                if digest(app / relative) != digest(mount / 'MQTTBox.app' / relative):
                    raise RuntimeError(f'DMG content mismatch: {arch} {relative}')
            if not (mount / 'Applications').is_symlink():
                raise RuntimeError(f'Missing Applications link: {arch}')
            print(f'{arch}: mounted app matches the tested app; Applications link present', flush=True)
        finally:
            if attached:
                run('hdiutil', 'detach', str(mount))
            mount.rmdir()
        records.append({
            'version': version, 'arch': arch, 'dmg': dmg.name,
            'bytes': dmg.stat().st_size, 'sha256': digest(dmg),
            'app': str(app.relative_to(root)),
            'appAsarSha256': digest(app / 'Contents/Resources/app.asar'),
            'minimumMacOS': info.get('LSMinimumSystemVersion'),
            'signature': 'ad-hoc' if 'Signature=adhoc' in signing else 'other',
            'notarized': False,
        })
    (root / 'dist/ARTIFACTS.json').write_text(json.dumps(records, indent=2) + '\n')
    (root / 'dist/SHA256SUMS.txt').write_text(''.join(
        f"{entry['sha256']}  {entry['dmg']}\n" for entry in records))
    print(json.dumps(records, indent=2), flush=True)


if __name__ == '__main__':
    main()

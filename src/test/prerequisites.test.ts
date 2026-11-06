import * as assert from 'assert';

import { findOnPath, gitInstallHint, parseOsRelease } from '../prerequisites';

// The launcher's git preflight. The filesystem is injected, so these exercise
// the PATH semantics without depending on what this machine has installed.
suite('prerequisites', () => {
  suite('findOnPath', () => {
    const only = (...files: string[]) => (f: string): boolean => files.includes(f);

    test('POSIX: first PATH entry holding the binary wins', () => {
      assert.strictEqual(
        findOnPath('git', '/usr/local/bin:/usr/bin', 'linux', '', only('/usr/bin/git', '/usr/local/bin/git')),
        '/usr/local/bin/git',
      );
    });

    test('POSIX: missing everywhere is null, and empty entries are skipped', () => {
      assert.strictEqual(findOnPath('git', ':/usr/bin:', 'linux', '', only('/bin/git')), null);
    });

    test('Windows: tries each PATHEXT extension, case as given', () => {
      assert.strictEqual(
        findOnPath('git', 'C:\\Windows;C:\\Program Files\\Git\\cmd', 'win32', '.COM;.EXE;.BAT',
          only('C:\\Program Files\\Git\\cmd\\git.EXE')),
        'C:\\Program Files\\Git\\cmd\\git.EXE',
      );
    });
  });

  suite('parseOsRelease', () => {
    test('strips quotes and ignores non-assignment lines', () => {
      const parsed = parseOsRelease('NAME="Amazon Linux"\nVERSION_ID="2023"\nID=amzn\n# comment\n');
      assert.deepStrictEqual(parsed, { NAME: 'Amazon Linux', VERSION_ID: '2023', ID: 'amzn' });
    });
  });

  suite('gitInstallHint', () => {
    test('Amazon Linux 2 uses yum, 2023 uses dnf', () => {
      assert.match(gitInstallHint('linux', { ID: 'amzn', VERSION_ID: '2' }), /sudo yum install -y git/);
      assert.match(gitInstallHint('linux', { ID: 'amzn', VERSION_ID: '2023' }), /sudo dnf install -y git/);
    });

    test('Debian family is recognized through ID_LIKE', () => {
      assert.match(gitInstallHint('linux', { ID: 'linuxmint', ID_LIKE: 'ubuntu debian' }), /sudo apt install -y git/);
    });

    test('an unknown distribution gets a generic pointer', () => {
      assert.match(gitInstallHint('linux', {}), /package manager/);
    });

    test('macOS and Windows', () => {
      assert.match(gitInstallHint('darwin', {}), /xcode-select --install/);
      assert.match(gitInstallHint('win32', {}), /winget install Git\.Git/);
    });
  });
});

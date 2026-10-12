// -----------------------------------------------------------------------------
// The Release workflow rolls CHANGELOG.md with .github/scripts/changelog-release.mjs
// and pushes the result straight to main: it must pass `format:check` too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

test('the real changelog has an Unreleased section and rolls Prettier-clean', async () => {
  const text = await readFile(changelogPath, 'utf8');
  const rolled = rollChangelog(text, '9.8.7', '2026-01-02');
  assert.notEqual(rolled, text, 'CHANGELOG.md needs a "## [Unreleased]" section');
  assert.match(rolled, /## \[Unreleased\]\n\n## \[9\.8\.7\] - 2026-01-02/);
  const options = { ...(await prettier.resolveConfig(changelogPath)), filepath: changelogPath };
  assert.equal(await prettier.format(rolled, options), rolled);
});

test('the first release links the tag, the next ones compare', () => {
  const REPO = 'https://github.com/prohand/gladys-rfplayer';
  const first = rollChangelog(
    `# Changelog\n\n## [Unreleased]\n\n- Thing.\n\n[Unreleased]: ${REPO}/commits/main\n`,
    '1.0.0',
    '2026-01-02',
  );
  assert.match(first, /\[1\.0\.0\]: .*\/releases\/tag\/v1\.0\.0/);
  const second = rollChangelog(
    first.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Fix.\n'),
    '1.0.1',
    '2026-01-03',
  );
  assert.match(second, /\[1\.0\.1\]: .*\/compare\/v1\.0\.0\.\.\.v1\.0\.1/);
});

test('an empty release still names the version', () => {
  const rolled = rollChangelog('# Changelog\n\n## [Unreleased]\n', '1.0.1', '2026-01-02');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-01-02\n\n- Maintenance release/);
});

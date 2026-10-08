import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseNotes } from '../../scripts/sync-draft-release.mjs';

test('release notes select only the exact version and stop at the next release section', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\nFuture work\n\n## [0.1.0]\n\n### Added\n\n- Current release.\n\n## [0.0.9]\nOld release\n';
  assert.equal(releaseNotes(changelog, '0.1.0'), '### Added\n\n- Current release.\n');
  assert.equal(releaseNotes(changelog.replaceAll('\n', '\r\n'), '0.1.0'), '### Added\r\n\r\n- Current release.\n');
});

test('missing, wrong, ambiguous and empty notes versions are rejected', () => {
  for (const changelog of [
    '# Changelog\n## [Unreleased]\nFuture work\n',
    '# Changelog\n## [0.1.1]\nWrong release\n',
    '# Changelog\n## [0.1.01]\nWrong release\n',
    '# Changelog\n## [0.1.0]\nFirst\n## [0.1.0]\nDuplicate\n',
  ]) assert.throws(() => releaseNotes(changelog, '0.1.0'), /exactly one ## \[0\.1\.0\] section/);
  assert.throws(() => releaseNotes('# Changelog\n## [0.1.0]\n\n## [0.0.9]\nOld\n', '0.1.0'), /release notes are empty/);
});

test('public changelog supplies notes for the manifest version without a private docs source', async () => {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const notes = releaseNotes(await readFile('CHANGELOG.md', 'utf8'), manifest.version);
  assert.match(notes, /mermaid-excalidraw/);
  assert.match(notes, /1\.14\.4/);
});

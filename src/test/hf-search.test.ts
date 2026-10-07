import * as assert from 'assert';

import { parseHfSearchReply } from '../extension/hf-search';

// The bridge turns a `local_llm.hf_search.ack` into the dialog's `hfSearch`
// state; the dialog trusts that shape, so anything malformed has to be dropped
// or defaulted here rather than reach the render.
suite('hf-search — local_llm.hf_search.ack parsing', () => {
  test('rows keep the server order and every field', () => {
    const result = parseHfSearchReply('qwen', {
      query: 'qwen',
      results: [
        {
          repo_id: 'Qwen/Qwen3-8B-GGUF', author: 'Qwen', publisher_tier: 'top', downloads: 5, likes: 2,
          gated: true, last_modified: '2026-08-13T08:28:40.000Z', base_model: 'Qwen/Qwen3-8B',
          license: 'apache-2.0', in_catalog: true,
        },
        { repo_id: 'someone/Popular-GGUF', publisher_tier: 'other', downloads: 900 },
      ],
      error: '',
    });
    assert.deepStrictEqual(result.results.map((r) => r.repo_id), ['Qwen/Qwen3-8B-GGUF', 'someone/Popular-GGUF']);
    assert.deepStrictEqual(result.results[0], {
      repo_id: 'Qwen/Qwen3-8B-GGUF', author: 'Qwen', publisher_tier: 'top', downloads: 5, likes: 2,
      gated: true, last_modified: '2026-08-13T08:28:40.000Z', base_model: 'Qwen/Qwen3-8B',
      license: 'apache-2.0', in_catalog: true,
    });
    assert.strictEqual(result.query, 'qwen');
    assert.strictEqual(result.error, '');
  });

  test('malformed rows are dropped and odd fields defaulted', () => {
    const result = parseHfSearchReply('x', {
      results: [null, 'row', { downloads: 3 }, { repo_id: 'a/b', publisher_tier: 'vip', downloads: 'many', gated: 'yes' }],
    });
    assert.strictEqual(result.results.length, 1);
    const [hit] = result.results;
    assert.strictEqual(hit.publisher_tier, 'other');
    assert.strictEqual(hit.downloads, 0);
    assert.strictEqual(hit.gated, false);
  });

  test('a failure reply carries its error and no rows', () => {
    const result = parseHfSearchReply('boom', { results: 'nope', error: 'Hugging Face search failed with HTTP 502' });
    assert.deepStrictEqual(result, { query: 'boom', results: [], error: 'Hugging Face search failed with HTTP 502' });
  });
});

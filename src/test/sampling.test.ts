import * as assert from 'assert';

import {
  samplingCliConflicts,
  samplingTextToValue,
  samplingValueToText,
  parseSamplingValues,
} from '../llm-registry-types';
import type { SamplingParamSpec } from '../llm-registry-types';
import { reducer, initial } from '../webview/reducer';

// Request-level sampling parameters (kodo/doc/SAMPLING.md). Pure functions
// plus reducer transitions — no VS Code window, WS or server involved.

const TEMPERATURE: SamplingParamSpec = {
  name: 'temperature',
  kind: 'float',
  label: 'Temperature',
  advanced: false,
  minimum: 0,
  maximum: 4,
  step: 0.05,
  neutral: '1.0',
  cli_flags: ['--temp', '--temperature'],
  help: '',
};

const TOP_K: SamplingParamSpec = {
  name: 'top_k',
  kind: 'int',
  label: 'Top-K',
  advanced: false,
  minimum: 0,
  maximum: 1000,
  step: 1,
  neutral: '0',
  cli_flags: ['--top-k'],
  help: '',
};

const BREAKERS: SamplingParamSpec = {
  name: 'dry_sequence_breakers',
  kind: 'str_list',
  label: 'DRY sequence breakers',
  advanced: true,
  minimum: null,
  maximum: null,
  step: null,
  neutral: '',
  cli_flags: ['--dry-sequence-breaker'],
  help: '',
};

suite('sampling — text <-> value', () => {
  test('a blank field is unset, NOT zero', () => {
    // The distinction is load-bearing: omitting a parameter inherits the
    // launch-time value, while 0 actively sets it (and disables several
    // samplers outright). See SAMPLING.md §1.
    assert.strictEqual(samplingTextToValue(TEMPERATURE, ''), undefined);
    assert.strictEqual(samplingTextToValue(TEMPERATURE, '   '), undefined);
  });

  test('zero is a real value, distinct from unset', () => {
    assert.strictEqual(samplingTextToValue(TEMPERATURE, '0'), 0);
    assert.strictEqual(samplingTextToValue(TOP_K, '0'), 0);
  });

  test('int fields truncate, float fields do not', () => {
    assert.strictEqual(samplingTextToValue(TOP_K, '40.9'), 40);
    assert.strictEqual(samplingTextToValue(TEMPERATURE, '0.35'), 0.35);
  });

  test('unparseable text is treated as unset, never NaN', () => {
    assert.strictEqual(samplingTextToValue(TEMPERATURE, 'warm'), undefined);
  });

  test('str_list splits on commas and drops empties', () => {
    assert.deepStrictEqual(samplingTextToValue(BREAKERS, ' ; , } , '), [';', '}']);
    assert.strictEqual(samplingTextToValue(BREAKERS, ' , , '), undefined);
  });

  test('round-trips through samplingValueToText', () => {
    assert.strictEqual(samplingValueToText(0.35), '0.35');
    assert.strictEqual(samplingValueToText([';', '}']), ';, }');
    assert.strictEqual(samplingValueToText(undefined), '');
  });
});

suite('sampling — CLI/request conflicts', () => {
  const specs = [TEMPERATURE, TOP_K, BREAKERS];

  test('flags a knob set both as a launch arg and a request default', () => {
    const conflicts = samplingCliConflicts({ '--temp': '0.6' }, { temperature: 0.2 }, specs);
    assert.deepStrictEqual(conflicts, { '--temp': 'temperature' });
  });

  test('recognises every CLI alias of the same knob', () => {
    assert.deepStrictEqual(
      samplingCliConflicts({ '--temperature': '0.6' }, { temperature: 0.2 }, specs),
      { '--temperature': 'temperature' },
    );
  });

  test('no conflict when only one side is set', () => {
    assert.deepStrictEqual(samplingCliConflicts({ '--temp': '0.6' }, {}, specs), {});
    assert.deepStrictEqual(samplingCliConflicts({}, { temperature: 0.2 }, specs), {});
  });

  test('ignores non-sampling launch args', () => {
    assert.deepStrictEqual(
      samplingCliConflicts({ '--ctx-size': '0', '--jinja': '' }, { temperature: 0.2 }, specs),
      {},
    );
  });
});

suite('sampling — parseSamplingValues', () => {
  test('passes a plain object through', () => {
    assert.deepStrictEqual(parseSamplingValues({ temperature: 0.2 }), { temperature: 0.2 });
  });

  test('rejects non-objects and arrays', () => {
    assert.deepStrictEqual(parseSamplingValues(null), {});
    assert.deepStrictEqual(parseSamplingValues(undefined), {});
    assert.deepStrictEqual(parseSamplingValues([1, 2]), {});
    assert.deepStrictEqual(parseSamplingValues('temperature=1'), {});
  });
});

suite('reducer — sampling_state', () => {
  test('adopts the pushed model, specs, defaults and values', () => {
    const next = reducer(initial, {
      type: 'sampling_state',
      model: 'llamacpp-qwen36-27b-q4-k-xl',
      specs: [TEMPERATURE],
      defaults: { temperature: 0.8 },
      values: { temperature: 0.1 },
    });

    assert.strictEqual(next.samplingModel, 'llamacpp-qwen36-27b-q4-k-xl');
    assert.deepStrictEqual(next.samplingSpecs, [TEMPERATURE]);
    assert.deepStrictEqual(next.samplingDefaults, { temperature: 0.8 });
    assert.deepStrictEqual(next.samplingValues, { temperature: 0.1 });
  });

  test('switching to a cloud model closes the modal along with the button', () => {
    // The footer button unmounts when `model` is '', so leaving the modal open
    // would strand a dialog over the feed with no way back to it.
    const open = reducer(
      { ...initial, samplingModel: 'some-quant' },
      { type: 'sampling_modal_open', open: true },
    );
    assert.strictEqual(open.samplingModalOpen, true);

    const cloud = reducer(open, {
      type: 'sampling_state',
      model: '',
      specs: [],
      defaults: {},
      values: {},
    });
    assert.strictEqual(cloud.samplingModalOpen, false);
  });

  test('a re-push for a still-local model leaves the modal open', () => {
    const open = reducer(
      { ...initial, samplingModel: 'some-quant' },
      { type: 'sampling_modal_open', open: true },
    );
    const next = reducer(open, {
      type: 'sampling_state',
      model: 'some-quant',
      specs: [TEMPERATURE],
      defaults: {},
      values: {},
    });
    assert.strictEqual(next.samplingModalOpen, true);
  });
});

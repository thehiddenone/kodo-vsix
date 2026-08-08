import * as assert from 'assert';

import {
  cliArgValueToSamplingValue,
  launchSamplingValues,
  samplingFieldError,
  samplingFieldIssue,
  samplingLabelText,
  samplingRangeWarning,
  samplingTextToValue,
  samplingValueToCliArgValue,
  samplingValueToText,
  parseSamplingValues,
  sensibleRangeText,
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
  sensible_minimum: 0,
  sensible_maximum: 2,
  step: 0.05,
  neutral: '1.0',
  cli_flags: ['--temp', '--temperature'],
  help: '',
  valid_values: null,
};

const TOP_K: SamplingParamSpec = {
  name: 'top_k',
  kind: 'int',
  label: 'Top-K',
  advanced: false,
  minimum: 0,
  maximum: 1000,
  sensible_minimum: 0,
  sensible_maximum: 200,
  step: 1,
  neutral: '0',
  cli_flags: ['--top-k'],
  help: '',
  valid_values: null,
};

// Its "off" value (0.0) sits *below* its useful active band — the case the
// neutral-value exemption exists for.
const MIN_P: SamplingParamSpec = {
  name: 'min_p',
  kind: 'float',
  label: 'Min-P',
  advanced: false,
  minimum: 0,
  maximum: 1,
  sensible_minimum: 0.01,
  sensible_maximum: 0.2,
  step: 0.01,
  neutral: '0.0',
  cli_flags: ['--min-p'],
  help: '',
  valid_values: null,
};

// No recommended band at all — every accepted seed is as good as any other.
const SEED: SamplingParamSpec = {
  name: 'seed',
  kind: 'int',
  label: 'Seed',
  advanced: false,
  minimum: -1,
  maximum: 2147483647,
  sensible_minimum: null,
  sensible_maximum: null,
  step: 1,
  neutral: '',
  cli_flags: ['-s', '--seed'],
  help: '',
  valid_values: null,
};

const BREAKERS: SamplingParamSpec = {
  name: 'dry_sequence_breakers',
  kind: 'str_list',
  label: 'DRY sequence breakers',
  advanced: true,
  minimum: null,
  maximum: null,
  sensible_minimum: null,
  sensible_maximum: null,
  step: null,
  neutral: '',
  cli_flags: ['--dry-sequence-breaker'],
  help: '',
  valid_values: null,
};

const SAMPLERS: SamplingParamSpec = {
  name: 'samplers',
  kind: 'str_list',
  label: 'Sampler order',
  advanced: true,
  minimum: null,
  maximum: null,
  sensible_minimum: null,
  sensible_maximum: null,
  step: null,
  neutral: '',
  cli_flags: ['--samplers'],
  help: '',
  valid_values: ['dry', 'min_p', 'penalties', 'temperature', 'top_k', 'top_n_sigma', 'top_p', 'typ_p', 'xtc'],
};

const MIN_KEEP: SamplingParamSpec = {
  name: 'min_keep',
  kind: 'int',
  label: 'Min keep',
  advanced: true,
  minimum: 0,
  maximum: 100,
  sensible_minimum: 0,
  sensible_maximum: 10,
  step: 1,
  neutral: '0',
  cli_flags: [],
  help: '',
  valid_values: null,
};

suite('sampling — recommended-range warning', () => {
  test('in-band values are clean, out-of-band ones warn', () => {
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, '0.7'), null);
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, '2'), null, 'the bound itself is in band');
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, '0'), null, 'greedy is a real choice');
    assert.notStrictEqual(samplingRangeWarning(TEMPERATURE, '2.6'), null);
    assert.notStrictEqual(samplingRangeWarning(MIN_P, '0.5'), null);
  });

  test('the warning names the band and how to turn the parameter off', () => {
    const warning = samplingRangeWarning(TEMPERATURE, '3.5') ?? '';
    assert.ok(warning.includes('0.0 to 2.0'), warning);
    assert.ok(warning.includes('Temperature'), warning);
    assert.ok(warning.includes('1.0'), 'should point at the neutral value: ' + warning);
  });

  test('the neutral value never warns, even from outside the band', () => {
    // Min-P is useful at 0.01–0.2 but *disabled* at 0.0. Flagging a
    // deliberate "off" would be pure noise — see SAMPLING.md §8d.
    assert.strictEqual(samplingRangeWarning(MIN_P, '0.0'), null);
    assert.strictEqual(samplingRangeWarning(MIN_P, '0'), null, 'same value, other spelling');
    assert.notStrictEqual(samplingRangeWarning(MIN_P, '0.005'), null, 'still warns just above off');
  });

  test('blank, half-typed and non-numeric fields never warn', () => {
    // Recomputed per keystroke, so an intermediate parse must not flicker.
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, ''), null);
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, '  '), null);
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, '-'), null);
    assert.strictEqual(samplingRangeWarning(TEMPERATURE, 'abc'), null);
  });

  test('specs with no band, and str_list specs, never warn', () => {
    assert.strictEqual(samplingRangeWarning(SEED, '999999999'), null);
    assert.strictEqual(samplingRangeWarning(BREAKERS, 'a, b, c'), null);
    assert.strictEqual(samplingRangeWarning(SAMPLERS, 'top_k, temperature'), null);
  });

  test('a spec from an older server (no band fields) never warns', () => {
    // `parseSamplingSpecs` is a pass-through cast, so a kodo predating this
    // feature yields `undefined` here — it must degrade to "no guidance"
    // rather than failing every comparison and flagging every value.
    const legacy = { ...TEMPERATURE } as Partial<SamplingParamSpec>;
    delete legacy.sensible_minimum;
    delete legacy.sensible_maximum;
    assert.strictEqual(samplingRangeWarning(legacy as SamplingParamSpec, '3.9'), null);
  });

  test('int specs parse as ints', () => {
    assert.strictEqual(samplingRangeWarning(TOP_K, '40'), null);
    assert.notStrictEqual(samplingRangeWarning(TOP_K, '900'), null);
  });
});

suite('sampling — field labels', () => {
  test('a label states the recommended band and the disable value', () => {
    assert.strictEqual(samplingLabelText(TEMPERATURE), 'Temperature (0.0 to 2.0, 1.0 disables)');
    assert.strictEqual(samplingLabelText(MIN_P), 'Min-P (0.01 to 0.2, 0.0 disables)');
  });

  test('whole float bounds keep their ".0"; int bounds stay bare', () => {
    // JSON hands us `2` for a spec's `2.0`, and "0 to 2" on a decimal field
    // reads as if only integers belong there.
    assert.strictEqual(samplingLabelText(TOP_K), 'Top-K (0 to 200, 0 disables)');
    assert.strictEqual(samplingLabelText(MIN_KEEP), 'Min keep (0 to 10, 0 disables)');
  });

  test('either half can be missing', () => {
    // No band, no neutral: nothing to add, so no parentheses at all.
    assert.strictEqual(samplingLabelText(SEED), 'Seed');
    // Band but no neutral.
    assert.strictEqual(
      samplingLabelText({ ...MIN_P, neutral: '' }),
      'Min-P (0.01 to 0.2)',
    );
    // Neutral but no band — `mirostat`'s shape: every mode is a real choice.
    assert.strictEqual(
      samplingLabelText({ ...SEED, label: 'Mirostat mode', neutral: '0' }),
      'Mirostat mode (0 disables)',
    );
  });

  test('one-sided bands read as "or above"/"or below"', () => {
    assert.strictEqual(
      samplingLabelText({ ...TEMPERATURE, sensible_maximum: null, neutral: '' }),
      'Temperature (0.0 or above)',
    );
    assert.strictEqual(
      samplingLabelText({ ...TEMPERATURE, sensible_minimum: null, neutral: '' }),
      'Temperature (2.0 or below)',
    );
  });

  test('the band is spelt with "to" so negative endpoints stay readable', () => {
    // `repeat_last_n`'s shape — a hyphen would read as a minus sign here.
    const lookback: SamplingParamSpec = {
      ...TOP_K,
      label: 'Repeat lookback',
      sensible_minimum: -1,
      sensible_maximum: 2048,
    };
    assert.strictEqual(samplingLabelText(lookback), 'Repeat lookback (-1 to 2048, 0 disables)');
  });

  test('str_list specs and older servers degrade to the bare label', () => {
    assert.strictEqual(samplingLabelText(BREAKERS), 'DRY sequence breakers');
    // A kodo predating the band fields: `undefined` must not reach the label.
    const legacy = { ...TEMPERATURE } as Partial<SamplingParamSpec>;
    delete legacy.sensible_minimum;
    delete legacy.sensible_maximum;
    assert.strictEqual(samplingLabelText(legacy as SamplingParamSpec), 'Temperature (1.0 disables)');
    assert.strictEqual(sensibleRangeText(legacy as SamplingParamSpec), null);
  });

  test('the label and the ⚠ tooltip quote the same band', () => {
    // Both read it off `sensibleRangeText`, so they cannot drift apart.
    const range = sensibleRangeText(TEMPERATURE) ?? '';
    assert.ok(samplingLabelText(TEMPERATURE).includes(range), range);
    assert.ok((samplingRangeWarning(TEMPERATURE, '3.5') ?? '').includes(range), range);
  });
});

suite('sampling — field hard errors (samplingFieldError)', () => {
  test('a blank field is never an error', () => {
    assert.strictEqual(samplingFieldError(SAMPLERS, ''), null);
    assert.strictEqual(samplingFieldError(SAMPLERS, '  '), null);
    assert.strictEqual(samplingFieldError(TEMPERATURE, ''), null);
  });

  test('an unknown sampler stage name errors; known ones do not', () => {
    assert.strictEqual(samplingFieldError(SAMPLERS, 'top_k, temperature'), null);
    assert.notStrictEqual(samplingFieldError(SAMPLERS, 'top_k, not_a_stage'), null);
  });

  test('the error names the bad entry and lists the valid names', () => {
    const error = samplingFieldError(SAMPLERS, 'not_a_stage') ?? '';
    assert.ok(error.includes('not_a_stage'), error);
    assert.ok(error.includes('temperature'), error);
  });

  test('a str_list spec with no valid_values (e.g. dry_sequence_breakers) never errors', () => {
    assert.strictEqual(samplingFieldError(BREAKERS, 'anything, goes'), null);
  });

  test('a numeric field with a digit that fails to parse errors', () => {
    assert.notStrictEqual(samplingFieldError(TEMPERATURE, '1.2.3'), null);
    assert.notStrictEqual(samplingFieldError(TOP_K, '12x'), null);
  });

  test('a valid number, including mid-typing prefixes, never errors', () => {
    assert.strictEqual(samplingFieldError(TEMPERATURE, '0.7'), null);
    assert.strictEqual(samplingFieldError(TEMPERATURE, '-'), null, 'typing a negative number');
    assert.strictEqual(samplingFieldError(TEMPERATURE, '.'), null, 'typing a fraction');
    assert.strictEqual(samplingFieldError(TEMPERATURE, '-.'), null, 'typing a negative fraction');
    assert.strictEqual(samplingFieldError(TEMPERATURE, '1.'), null, 'trailing decimal point');
  });

  test('a spec from an older server (no valid_values field) never errors on str_list', () => {
    const legacy = { ...SAMPLERS } as Partial<SamplingParamSpec>;
    delete legacy.valid_values;
    assert.strictEqual(samplingFieldError(legacy as SamplingParamSpec, 'not_a_stage'), null);
  });
});

suite('sampling — combined field issue (samplingFieldIssue)', () => {
  // Both the session sampling modal and the profile editor render this one
  // function's result as a single yellow ⚠ and (session modal only) gate
  // Apply on it — a hard error and an out-of-band value are no longer
  // visually or behaviorally distinguished, only the tooltip text differs.
  test('a clean, in-band value has no issue', () => {
    assert.strictEqual(samplingFieldIssue(TEMPERATURE, '0.7'), null);
    assert.strictEqual(samplingFieldIssue(SAMPLERS, 'top_k, temperature'), null);
  });

  test('an out-of-band value (no hard error) is flagged via the range warning', () => {
    const issue = samplingFieldIssue(TEMPERATURE, '3.5');
    assert.notStrictEqual(issue, null);
    assert.strictEqual(issue, samplingRangeWarning(TEMPERATURE, '3.5'));
  });

  test('a hard error is flagged even when the value would also be in-band', () => {
    // An unknown sampler name has no "band" to be in or out of — the hard
    // error is the only possible signal, and it must still surface.
    const issue = samplingFieldIssue(SAMPLERS, 'top_k, not_a_stage');
    assert.notStrictEqual(issue, null);
    assert.strictEqual(issue, samplingFieldError(SAMPLERS, 'top_k, not_a_stage'));
  });

  test('a hard error takes priority over an out-of-band range warning', () => {
    // Unparseable text can't be range-checked at all, so the hard-error
    // message is the only one that could ever apply here — this just pins
    // down that samplingFieldError is consulted first.
    const issue = samplingFieldIssue(TEMPERATURE, '1.2.3');
    assert.strictEqual(issue, samplingFieldError(TEMPERATURE, '1.2.3'));
  });

  test('the neutral (off) value is never flagged, even outside its band', () => {
    assert.strictEqual(samplingFieldIssue(MIN_P, '0.0'), null);
  });
});

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

suite('sampling — CLI arg value <-> typed value', () => {
  test('numbers round-trip verbatim', () => {
    assert.strictEqual(cliArgValueToSamplingValue(TEMPERATURE, '0.6'), 0.6);
    assert.strictEqual(samplingValueToCliArgValue(TEMPERATURE, 0.6), '0.6');
  });

  test('str_list uses comma except `samplers`, which uses semicolon', () => {
    assert.deepStrictEqual(cliArgValueToSamplingValue(BREAKERS, 'nl, colon, quote'), ['nl', 'colon', 'quote']);
    assert.strictEqual(samplingValueToCliArgValue(BREAKERS, ['nl', 'colon', 'quote']), 'nl,colon,quote');

    assert.deepStrictEqual(cliArgValueToSamplingValue(SAMPLERS, 'top_k;top_p;temperature'), [
      'top_k',
      'top_p',
      'temperature',
    ]);
    assert.strictEqual(samplingValueToCliArgValue(SAMPLERS, ['top_k', 'top_p']), 'top_k;top_p');
  });

  test('a blank raw value is unset', () => {
    assert.strictEqual(cliArgValueToSamplingValue(TEMPERATURE, ''), undefined);
    assert.strictEqual(cliArgValueToSamplingValue(TEMPERATURE, '   '), undefined);
  });
});

suite('sampling — launchSamplingValues (sampling has no state of its own at the launch layer)', () => {
  const specs = [TEMPERATURE, TOP_K, MIN_KEEP];

  test('reads values straight out of llama_args', () => {
    const llamaArgs = { '--temp': '0.6', '--top-k': '40' };
    assert.deepStrictEqual(launchSamplingValues(llamaArgs, specs), { temperature: 0.6, top_k: 40 });
  });

  test('recognises every CLI alias of the same knob', () => {
    const llamaArgs = { '--temperature': '0.6' };
    assert.deepStrictEqual(launchSamplingValues(llamaArgs, specs), { temperature: 0.6 });
  });

  test('empty llama_args yields no defaults', () => {
    assert.deepStrictEqual(launchSamplingValues({}, specs), {});
  });

  test('min_keep has no CLI flag, so it never appears even if somehow present', () => {
    // min_keep.cli_flags is [] — the loop over cli_flags never runs for it,
    // regardless of what unrelated flags llama_args happens to carry.
    const llamaArgs = { '--temp': '0.6' };
    assert.deepStrictEqual(launchSamplingValues(llamaArgs, specs), { temperature: 0.6 });
  });

  test('ignores unrelated launch args', () => {
    const llamaArgs = { '--ctx-size': '0', '--jinja': '' };
    assert.deepStrictEqual(launchSamplingValues(llamaArgs, specs), {});
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

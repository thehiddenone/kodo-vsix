/** The Bedrock tab's profile dropdown: what it lists and what is selected.
 *  Kept apart from the component so the rules can be tested without a DOM. */

/** The dropdown value for botocore's default credential chain. It is also what
 *  `bedrock_profile` holds then: no profile, so AWS_PROFILE stays unset. */
export const DEFAULT_CHAIN_VALUE = '';

/** The dropdown value of the "Custom" entry. Starts with characters a profile
 *  name would not, so a real profile can't collide with it. */
export const CUSTOM_PROFILE_VALUE = '__kodo_custom__';

/**
 * Which dropdown entry to show as selected.
 *
 * A saved profile that isn't listed is a custom one, which is the state a
 * reopened panel has to come back to: only the name is saved, so "Custom" can't
 * be remembered any other way.
 *
 * @param profile The saved `bedrock_profile`.
 * @param profiles The profiles the server listed.
 * @param customChosen The user has just picked "Custom" and typed nothing yet.
 */
export function selectedProfileValue(profile: string, profiles: string[], customChosen: boolean): string {
  if (customChosen) {
    return CUSTOM_PROFILE_VALUE;
  }
  return profile === DEFAULT_CHAIN_VALUE || profiles.includes(profile) ? profile : CUSTOM_PROFILE_VALUE;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The errors in a row of each contribution of a plugin: the count of each `<plugin>:<name>` since its last start by
 * the person. At MAX_ERRORS, the contribution is disabled in each place where it shows. It stays disabled until the
 * person enables it again (ContributionBoundary.vue).
 */
import { reactive } from "vue";

/** The count of errors that disables a contribution. */
export const MAX_ERRORS = 3;

/** The errors in a row of each contribution. */
export const contributionErrors = reactive(new Map<string, number>());

/**
 * i18n bridge for rpiv-ask-user-question — single thin import surface so every
 * call site routes through one place. Backed by `@juicesharp/rpiv-i18n`'s SDK
 * when available; degrades to canonical-English fallbacks when not.
 *
 * - `t(key, fallback)` is `scope("@juicesharp/rpiv-ask-user-question")` if the
 *   SDK is installed (live `/languages` updates propagate). If the SDK is
 *   missing (standalone install without rpiv-i18n), `t` is an identity
 *   passthrough that returns the inline English fallback at every call site,
 *   so the extension stays online with English UI.
 * - `displayLabel(kind)` resolves a sentinel kind to its locale-aware label,
 *   with the canonical English `ROW_INTENT_META[kind].label` as fallback so
 *   nothing renders blank if the namespace isn't registered.
 *
 * Call sites resolve strings at render time so live locale changes propagate.
 *
 * Reserved-label validation stays English-locked: `RESERVED_LABEL_SET` checks
 * the canonical `ROW_INTENT_META[kind].label`, never `displayLabel(kind)`.
 */

import { ROW_INTENT_META, type SentinelKind } from "./row-intent.js";

export const I18N_NAMESPACE = "@juicesharp/rpiv-ask-user-question";

type ScopeFn = (key: string, fallback: string) => string;
type I18nSDK = { scope: (namespace: string) => ScopeFn };
type I18nLoader = {
	registerLocalesFromDir: (namespace: string, packageUrl: string, options?: { label?: string }) => void;
};

export interface I18nDependencies {
	loadSdk: () => Promise<I18nSDK>;
	loadLoader: () => Promise<I18nLoader>;
}

const sdkModule = "@juicesharp/rpiv-i18n";
const loaderModule = "@juicesharp/rpiv-i18n/loader";
const defaultDependencies: I18nDependencies = {
	loadSdk: () => import(sdkModule) as Promise<I18nSDK>,
	loadLoader: () => import(loaderModule) as Promise<I18nLoader>,
};

let scopeImpl: ScopeFn = (_key, fallback) => fallback;
let initialization: Promise<void> | undefined;

export function initializeI18n(dependencies: I18nDependencies = defaultDependencies): Promise<void> {
	initialization ??= Promise.all([
		dependencies
			.loadSdk()
			.then((sdk) => {
				scopeImpl = sdk.scope(I18N_NAMESPACE);
			})
			.catch(() => {}),
		dependencies
			.loadLoader()
			.then((loader) => {
				loader.registerLocalesFromDir(I18N_NAMESPACE, new URL("../index.ts", import.meta.url).href, {
					label: "rpiv-ask-user-question",
				});
			})
			.catch(() => {}),
	]).then(() => {});
	return initialization;
}

export const t: ScopeFn = (key, fallback) => scopeImpl(key, fallback);

export function displayLabel(kind: SentinelKind): string {
	return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}

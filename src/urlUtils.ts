/**
 * URL helpers.
 *
 * Kept free of any `vscode` import so it can be tested on its own.
 * @packageDocumentation
 */

/**
 * Encodes each segment of a slash-separated path.
 *
 * Names with spaces, `#`, `%`, `?`, `&` or accents then make a valid URL, while the slashes between
 * the segments are kept.
 *
 * @param value - A path such as `pages/my folder/file #1.cfm`.
 * @returns The same path with every segment URL-encoded, e.g. `pages/my%20folder/file%20%231.cfm`.
 */
export function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
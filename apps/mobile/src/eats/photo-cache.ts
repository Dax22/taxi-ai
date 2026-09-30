/** Cleanup is limited to a generated file in our cache, never the selected source. */
export function canDeleteGeneratedPhoto(output: string, source: string, cache: string): boolean {
  try {
    const generated = new URL(output), selected = new URL(source), directory = new URL(cache);
    const prefix = decodeURIComponent(directory.pathname).replace(/\/$/, '') + '/';
    const generatedPath = decodeURIComponent(generated.pathname), selectedPath = decodeURIComponent(selected.pathname);
    return generated.protocol === 'file:' && directory.protocol === 'file:'
      && generated.host === directory.host && generatedPath.startsWith(prefix)
      && !generatedPath.split('/').some((part) => part === '..' || part === '.')
      && generated.href !== selected.href && generatedPath !== selectedPath;
  } catch { return false; }
}

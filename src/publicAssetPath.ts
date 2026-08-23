/**
 * Resolve a file copied from Vite's public directory at either the local root
 * or a GitHub Pages project path. BASE_URL is `/` in local development and
 * `./` in the Pages build.
 */
export function publicAssetPath(asset: string, baseUrl = import.meta.env.BASE_URL): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${asset.replace(/^\/+/, "")}`;
}

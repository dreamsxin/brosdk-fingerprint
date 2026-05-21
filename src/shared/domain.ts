export const getHostname = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
};

export const domainMatches = (whitelist: string[], hostname: string | undefined): boolean => {
  if (!hostname) return false;
  return whitelist.some((domain) => {
    const clean = domain.trim().toLowerCase();
    const host = hostname.toLowerCase();
    return host === clean || host.endsWith(`.${clean}`);
  });
};


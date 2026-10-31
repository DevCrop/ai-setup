// The home folder as bash prints it (/c/Users/x, C:/Users/x) or Windows does (C:\Users\x) becomes ~.
export function maskHome(text, homeDir) {
  if (!homeDir) return text;
  const fwd = homeDir.replaceAll('\\', '/');
  const msys = fwd.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  return [homeDir, fwd, msys].reduce((t, v) => t.split(v).join('~'), text);
}

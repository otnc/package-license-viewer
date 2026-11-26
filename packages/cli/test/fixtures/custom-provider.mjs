export default {
  supports(document) {
    return new URL(document.uri).pathname.endsWith("/example.deps");
  },
  parse(document) {
    return document
      .getText()
      .split(/\r?\n/)
      .flatMap((text, line) => {
        if (!text.trim()) return [];
        const [name, spec, license] = text.trim().split(/\s+/);
        return [{ name, spec, line, section: "dependencies", license }];
      });
  },
  async resolve(entry) {
    return { license: entry.license, version: entry.spec, source: "local" };
  },
};

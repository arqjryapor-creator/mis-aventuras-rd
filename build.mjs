/* Construye una versión de un solo archivo (dist/mis-aventuras-rd.html).
   Útil para publicar en cualquier hosting estático o abrir directamente. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const inlineJs = (code) => code.replace(/<\/script/gi, "<\\/script");

let html = read("index.html");
const css = read("assets/css/styles.css");
const zip = read("assets/js/zip.js");
const geo = read("assets/js/geo-data.js");
const map = read("assets/js/map.js");
const app = read("assets/js/app.js");

html = html.replace(
  '<link rel="stylesheet" href="assets/css/styles.css">',
  "<style>\n" + css + "\n</style>"
);
html = html.replace(
  '<script src="assets/js/zip.js" defer></script>',
  "<script>\n" + inlineJs(zip) + "\n</script>"
);
html = html.replace(
  '<script src="assets/js/geo-data.js" defer></script>',
  "<script>\n" + inlineJs(geo) + "\n</script>"
);
html = html.replace(
  '<script src="assets/js/map.js" defer></script>',
  "<script>\n" + inlineJs(map) + "\n</script>"
);
html = html.replace(
  '<script src="assets/js/app.js" defer></script>',
  "<script>\n" + inlineJs(app) + "\n</script>"
);

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "mis-aventuras-rd.html");
writeFileSync(out, html, "utf8");
// Copia con nombre index.html para poder publicar la carpeta dist/ directamente.
writeFileSync(join(root, "dist", "index.html"), html, "utf8");
console.log("Generado:", out);
console.log("Generado:", join(root, "dist", "index.html"));
console.log("Tamaño:", (Buffer.byteLength(html, "utf8") / 1024).toFixed(1), "KB");

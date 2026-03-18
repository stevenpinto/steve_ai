const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "src/widget.css"), "utf-8");
let js = fs.readFileSync(path.join(__dirname, "src/widget.js"), "utf-8");

// Escape backticks and ${} in CSS for template literal safety
const escapedCss = css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

js = js.replace("const WIDGET_CSS = `__WIDGET_CSS__`;", `const WIDGET_CSS = \`${escapedCss}\`;`);

fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist/steve-ai-widget.js"), js);

console.log("Widget built → dist/steve-ai-widget.js");

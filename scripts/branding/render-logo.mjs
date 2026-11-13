import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const input = readFileSync("public/icons/attendance-logo.svg", "utf8");
const png = new Resvg(input, { fitTo: { mode: "width", value: 1024 }, background: "#090909" }).render().asPng();
writeFileSync("public/icons/attendance-logo.png", png);

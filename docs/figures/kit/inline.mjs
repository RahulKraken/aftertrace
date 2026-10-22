// From the Anatomy skill (github.com/wheresryan22/anatomy, MIT, see LICENSE):
// the kit and its WebGL layer as source to inline into a standalone page.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export /gm, "")

export const kitScript = () => strip("iso-kit.mjs")
export const glScript = () => strip("gl.mjs")

import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const COMPRESSIBLE = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".xml", ".wasm"]);
const MIN_BYTES = 256;

async function filesUnder(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, absolute));
    else if (entry.isFile() && !absolute.endsWith(".br") && !absolute.endsWith(".gz")) files.push(absolute);
  }
  return files;
}

export async function compressWebDist(root) {
  await mkdir(root, { recursive: true });
  let sourceBytes = 0;
  let brotliBytes = 0;
  let gzipBytes = 0;
  let compressedFiles = 0;

  for (const file of await filesUnder(root)) {
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
    const bytes = await readFile(file);
    sourceBytes += bytes.length;
    if (bytes.length < MIN_BYTES) continue;

    const [br, gz] = await Promise.all([
      brotli(bytes, {
        params: {
          0x100: 11,
          0x101: 22
        }
      }),
      gzipAsync(bytes, { level: 9 })
    ]);

    if (br.length < bytes.length) {
      await writeFile(file + ".br", br);
      brotliBytes += br.length;
    }
    if (gz.length < bytes.length) {
      await writeFile(file + ".gz", gz);
      gzipBytes += gz.length;
    }
    compressedFiles += 1;
  }

  return { sourceBytes, brotliBytes, gzipBytes, compressedFiles };
}

async function main() {
  const root = path.resolve(process.argv[2] ?? "apps/web/dist");
  const summary = await compressWebDist(root);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}

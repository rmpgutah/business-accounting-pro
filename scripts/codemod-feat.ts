/**
 * Codemod: one-line `ipcMain.handle('feat:…', …)` handlers -> `featHandlers` table entries.
 *
 *   tsx scripts/codemod-feat.ts <accessor>   entries on stdout, untransformable lines on stderr
 *   tsx scripts/codemod-feat.ts --all        per-accessor transformable/manual counts
 *
 * Conventions (fixed arity: service, ONE payload, ctx last):
 *  - `mutates: true` iff the body called scheduleAutoBackup() (never inferred from method names).
 *  - `requiresCompany` is the verbatim value of the `if (!cid) return <v>;` guard.
 *  - ctx is destructured as `{ cid }` only when the returned expression used `cid`.
 */
import fs from 'fs';
import path from 'path';

const SHAPE =
  /^\s*ipcMain\.handle\('(?<ch>feat:[^']+)',\s*(?<async>async\s+)?\((?<params>[^)]*)\)\s*=>\s*\{\s*try\s*\{\s*(?<body>.*?)\s*\}\s*catch\s*\((?<ev>\w+):\s*any\)\s*\{\s*return\s*\{\s*error:\s*\k<ev>\?\.message\s*\};?\s*\}\s*\}\);\s*$/;

const CID_DECL = /^const cid = db\.getCurrentCompanyId\(\);\s*/;
const CID_GUARD =
  /^if \(!cid\) return (\[\]|null|true|false|-?\d+|'[^']*'|\"[^\"]*\"|\{[^}]*\});\s*/;
const BACKUP = /\s*scheduleAutoBackup\(\);/;
// `acc().f(args); [const _r = ]{ ok: true }; return` — void service call, constant ok result
const VOID_OK =
  /^(?<stmt>[a-z][a-z0-9_]*\(\)\..*?);\s*(?:const _?r = \{ ok: true \};\s*return _?r;|return \{ ok: true \};)$/i;
const RETURN = /^(?:const _?r = (?<e1>.*?);\s*return _?r;|return (?<e2>.*?);)$/;

/** Split on commas that are not nested in (), [], {} or strings. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = '';
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim());
}

export interface Transformed {
  channel: string;
  entry: string;
  accessor: string;
}

export function transformFeatLine(line: string): Transformed | null {
  const m = SHAPE.exec(line);
  if (!m?.groups) return null;
  const { ch, params, async: isAsync = '' } = m.groups;
  let body = m.groups.body.trim();

  const [first, ...payloadParams] = splitTopLevel(params);
  if (first !== undefined && first !== '_e' && first !== '_event') return null;
  if (payloadParams.length > 1) return null; // fixed arity: one payload only
  const payload = payloadParams[0] ?? '';
  if (/\bs\b/.test(payload)) return null; // payload binding would collide with the service parameter `s`

  let declaresCid = false;
  let requires: string | undefined;
  if (CID_DECL.test(body)) {
    declaresCid = true;
    body = body.replace(CID_DECL, '');
  }
  const g = CID_GUARD.exec(body);
  if (g) {
    if (!declaresCid) return null;
    requires = g[1];
    body = body.slice(g[0].length);
  }

  const mutates = BACKUP.test(body);
  if (mutates) body = body.replace(BACKUP, '');

  const voidOk = VOID_OK.exec(body.trim());
  const ret = voidOk ? null : RETURN.exec(body.trim());
  if (!voidOk && !ret?.groups) return null;
  let expr = voidOk ? voidOk.groups!.stmt.trim() : (ret!.groups!.e1 ?? ret!.groups!.e2).trim();
  if (expr.includes(';') || /\bscheduleAutoBackup\b|\bdb\./.test(expr)) return null;

  const accessor = /\b(?<acc>[a-z][a-z0-9_]*)\(\)\./i.exec(expr)?.groups?.acc;
  if (!accessor) return null;
  expr = expr.replace(new RegExp(`\\b${accessor}\\(\\)\\.`, 'g'), 's.');
  if (new RegExp(`\\b${accessor}\\(\\)`).test(expr)) return null;

  const usesCid = declaresCid && /\bcid\b/.test(expr);
  if (!declaresCid && /\bcid\b/.test(expr)) return null;
  if (requires !== undefined && usesCid) expr = expr.replace(/\bcid\b(?!!)/g, 'cid!');
  if (voidOk) expr = `{ ${expr}; return { ok: true }; }`;
  else if (expr.startsWith('{')) expr = `(${expr})`; // object literal as arrow body needs parens

  const ps = ['s'];
  if (payload || usesCid) ps.push(payload || '_p: any');
  if (usesCid) ps.push('{ cid }');
  const tail =
    (mutates ? ', mutates: true' : '') +
    (requires !== undefined ? `, requiresCompany: ${requires}` : '');
  return {
    accessor,
    channel: ch,
    entry: `'${ch}': { call: ${isAsync}(${ps.join(', ')}) => ${expr}${tail} },`,
  };
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: tsx scripts/codemod-feat.ts <accessor>|--all');
    process.exit(2);
  }
  const file = path.resolve(__dirname, '..', 'src/main/ipc/index.ts');
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.includes("ipcMain.handle('feat:"));

  if (arg === '--all') {
    const stats = new Map<string, { ok: number; manual: number }>();
    const bump = (k: string, f: 'ok' | 'manual') => {
      const s = stats.get(k) ?? { ok: 0, manual: 0 };
      s[f]++;
      stats.set(k, s);
    };
    for (const l of lines) {
      const r = transformFeatLine(l);
      if (r) bump(r.accessor, 'ok');
      else bump(/\b([a-z][a-z0-9_]*)\(\)\./i.exec(l)?.[1] ?? '(none)', 'manual');
    }
    let ok = 0,
      manual = 0;
    console.log('accessor\ttransformable\tmanual');
    for (const [k, v] of [...stats].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`${k}\t${v.ok}\t${v.manual}`);
      ok += v.ok;
      manual += v.manual;
    }
    console.log(
      `TOTAL\t${ok}\t${manual}\t(${((ok / (ok + manual)) * 100).toFixed(1)}% of ${ok + manual})`,
    );
    return;
  }

  const ok: string[] = [];
  const bad: string[] = [];
  for (const l of lines) {
    if (!new RegExp(`\\b${arg}\\(\\)`).test(l)) continue;
    const r = transformFeatLine(l);
    if (r && r.accessor === arg) ok.push(r.entry);
    else bad.push(l);
  }
  console.log(ok.join('\n'));
  console.error(
    `\n# ${ok.length} transformed, ${bad.length} lines need manual transcription:\n${bad.join('\n')}`,
  );
}

if (require.main === module) main();

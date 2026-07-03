import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const DATA_DIR = join(PKG_ROOT, "data");

const ICONS_REL = "frontend-arvore-nextjs/src/components/icons";

function resolveIconsDir(): string {
  if (process.env.ICONS_DIR) return resolve(process.env.ICONS_DIR);
  let dir = PKG_ROOT;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ICONS_REL);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${ICONS_REL} walking up from ${PKG_ROOT}. Set ICONS_DIR to override.`,
  );
}

const SYNONYMS: Record<string, string[]> = {
  add: ["plus", "create", "new", "adicionar", "novo", "criar"],
  remove: ["minus", "delete", "trash", "remover", "excluir", "apagar"],
  edit: ["pencil", "write", "editar", "escrever"],
  close: ["x", "cancel", "dismiss", "fechar", "cancelar"],
  check: ["ok", "done", "success", "confirmar", "concluido", "sucesso"],
  alert: ["warning", "attention", "aviso", "atencao", "alerta"],
  search: ["find", "magnifier", "buscar", "procurar", "lupa"],
  home: ["house", "inicio", "casa"],
  user: ["person", "profile", "account", "usuario", "perfil", "conta", "pessoa"],
  settings: ["gear", "cog", "config", "configuracao", "ajustes"],
  book: ["reading", "livro", "leitura"],
  arrow: ["chevron", "direction", "seta", "direcao"],
  star: ["favorite", "estrela", "favorito"],
  heart: ["like", "love", "coracao", "curtir"],
  bell: ["notification", "sino", "notificacao"],
  calendar: ["date", "schedule", "calendario", "data", "agenda"],
  chat: ["message", "comment", "conversa", "mensagem", "comentario"],
  lock: ["secure", "private", "cadeado", "seguro", "privado"],
  play: ["start", "video", "reproduzir", "iniciar"],
  download: ["save", "baixar", "salvar"],
  upload: ["send", "enviar", "subir"],
  trophy: ["celebracao", "celebrar", "conquista", "premio", "vitoria", "winner", "achievement"],
  medal: ["celebracao", "conquista", "premio", "achievement", "medalha"],
  award: ["celebracao", "conquista", "premio", "achievement", "premiacao"],
  badge: ["conquista", "selo", "achievement", "emblema"],
  party: ["celebracao", "festa", "comemorar", "celebrar", "celebration"],
  fireworks: ["celebracao", "comemoracao", "fogos", "celebration"],
  gift: ["presente", "recompensa", "reward", "premio"],
  balloon: ["festa", "celebracao", "balao", "comemoracao"],
  student: ["aluno", "estudante", "aprendiz"],
  teacher: ["professor", "educador", "docente"],
  school: ["escola", "colegio"],
  logout: ["sair", "signout", "exit"],
  login: ["entrar", "signin", "acessar"],
  filter: ["filtro", "filtrar"],
  menu: ["hamburger", "opcoes"],
  info: ["informacao", "sobre", "detalhes"],
  eye: ["ver", "visualizar", "view", "olho"],
  clock: ["hora", "tempo", "relogio", "time"],
};

const FILE_ALIASES: Record<string, string[]> = {
  chalkboard: ["professor", "educador", "teacher", "aula", "lousa", "quadro"],
  "door-hanger": ["sair", "logout", "exit", "porta"],
  "do-not-enter": ["bloqueado", "proibido", "acesso-negado"],
  backpack: ["aluno", "estudante", "mochila", "student"],
  "graduation-cap": ["formatura", "aluno", "estudante", "graduacao", "student"],
};

function toExportName(fileBase: string): string {
  const pascal = fileBase
    .split("-")
    .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
    .join("");
  return `${pascal}Icon`;
}

function keywordsFor(fileBase: string): string[] {
  const parts = fileBase.split("-").filter(Boolean);
  const kw = new Set<string>(parts);
  kw.add(fileBase);
  kw.add(fileBase.replace(/-/g, " "));
  for (const part of parts) {
    const syns = SYNONYMS[part];
    if (syns) for (const s of syns) kw.add(s);
  }
  const aliases = FILE_ALIASES[fileBase];
  if (aliases) for (const a of aliases) kw.add(a);
  return [...kw];
}

function build(): void {
  const iconsDir = resolveIconsDir();

  const files = readdirSync(iconsDir)
    .filter((f) => f.endsWith(".tsx") && f !== "index.tsx")
    .map((f) => f.replace(/\.tsx$/, ""))
    .filter((base) => base !== "index");

  const icons = files
    .sort()
    .map((base) => ({
      name: toExportName(base),
      file: base,
      keywords: keywordsFor(base),
    }));

  mkdirSync(DATA_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    source: "frontend-arvore-nextjs/src/components/icons",
    importPath: "@/components/icons",
    count: icons.length,
    icons,
  };
  const target = join(DATA_DIR, "icons.manifest.json");
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

  const barrelPath = join(iconsDir, "index.ts");
  let barrelNote = "";
  try {
    readFileSync(barrelPath, "utf-8");
    barrelNote = " (barrel index.ts present)";
  } catch {
    barrelNote = " (no barrel index.ts found)";
  }

  process.stdout.write(
    `Wrote ${icons.length} icons to ${target}${barrelNote}\n`,
  );
}

build();

const express = require("express");
const session = require("express-session");
const { DatabaseSync } = require("node:sqlite");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================================
   BANCO DE DADOS
   (usa o módulo SQLite nativo do Node — sem instalar nada, sem compilar nada)
   ========================================================================= */
const db = new DatabaseSync(path.join(__dirname, "boats.db"));

db.prepare(`
CREATE TABLE IF NOT EXISTS boats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo TEXT,
  ano TEXT,
  motorizacao TEXT,
  localizacao TEXT,
  foto TEXT,
  condicao TEXT,
  pdf TEXT
)`).run();

/* =========================================================================
   MIGRAÇÃO — novas colunas (descrição e galeria de fotos extras)
   Roda em todo início do servidor; só adiciona a coluna se ela ainda não
   existir, então não apaga nem duplica nada em quem já tinha o banco antigo.
   ========================================================================= */
function migrarColuna(nome, tipoSql) {
  const colunas = db.prepare("PRAGMA table_info(boats)").all();
  if (!colunas.some((c) => c.name === nome)) {
    db.exec(`ALTER TABLE boats ADD COLUMN ${nome} ${tipoSql}`);
    console.log(`Coluna "${nome}" adicionada à tabela boats.`);
  }
}
migrarColuna("descricao", "TEXT");
migrarColuna("galeria", "TEXT"); // guarda um JSON com a lista de fotos extras, ex: ["img/a.jpg","img/b.jpg"]

// Semeia o banco com os barcos que já existiam no boats.json, só na primeira vez
const totalBarcos = db.prepare("SELECT COUNT(*) AS n FROM boats").get().n;
if (totalBarcos === 0) {
  const seedPath = path.join(__dirname, "seed-boats.json");
  if (fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    const inserir = db.prepare(`
      INSERT INTO boats (modelo, ano, motorizacao, localizacao, foto, condicao, pdf)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");
    seed.forEach((b) =>
      inserir.run(b.modelo, b.ano, b.motorizacao, b.localizacao, b.foto, b.condicao, b.pdf)
    );
    db.exec("COMMIT");
    console.log(`Banco criado e populado com ${seed.length} embarcações do seed-boats.json`);
  }
}

/* =========================================================================
   LOGIN (usuário/senha configuráveis por variável de ambiente)
   ========================================================================= */
const ADMIN_USER = process.env.ADMIN_USER || "percio";
const ADMIN_PASS = process.env.ADMIN_PASS || "schaefer2026";

/* =========================================================================
   UPLOAD DE ARQUIVOS (multer)
   ========================================================================= */
const pastaImg = path.join(__dirname, "public", "img");
const pastaPdf = path.join(__dirname, "public", "pdfs");
fs.mkdirSync(pastaImg, { recursive: true });
fs.mkdirSync(pastaPdf, { recursive: true });

/* =========================================================================
   REPARO DE PDFs COM CAMINHO ANTIGO
   Embarcações que vieram do antigo boats.json guardaram só o nome do
   arquivo (ex: "v33.pdf"), de uma época em que o PDF ficava na raiz do
   site. Hoje os PDFs enviados pelo painel ficam em public/pdfs com um
   prefixo de data/hora (ex: "pdfs/1785201853224-v33.pdf"). Esta rotina
   roda a cada início do servidor e conserta esses registros antigos,
   casando o nome salvo com o arquivo real mais parecido na pasta pdfs.
   Não faz nada com registros que já estão corretos ou vazios.
   ========================================================================= */
function repararPdfsAntigos() {
  let arquivosPdf;
  try {
    arquivosPdf = fs.readdirSync(pastaPdf);
  } catch {
    return;
  }
  const boatsComPdf = db
    .prepare("SELECT id, pdf FROM boats WHERE pdf IS NOT NULL AND pdf != ''")
    .all();
  const atualizar = db.prepare("UPDATE boats SET pdf = ? WHERE id = ?");

  boatsComPdf.forEach((b) => {
    if (b.pdf.startsWith("pdfs/")) return; // já está no formato certo

    const nomeAntigo = b.pdf.toLowerCase();
    const encontrado = arquivosPdf.find((f) => {
      const fLower = f.toLowerCase();
      return fLower === nomeAntigo || fLower.endsWith("-" + nomeAntigo);
    });

    if (encontrado) {
      atualizar.run("pdfs/" + encontrado, b.id);
      console.log(`PDF corrigido: embarcação #${b.id} -> pdfs/${encontrado}`);
    } else {
      console.log(`Aviso: não achei arquivo correspondente a "${b.pdf}" (embarcação #${b.id})`);
    }
  });
}
repararPdfsAntigos();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "pdf") cb(null, pastaPdf);
    else cb(null, pastaImg);
  },
  filename: (req, file, cb) => {
    const nomeLimpo = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, Date.now() + "-" + nomeLimpo);
  },
});
const upload = multer({ storage });
const uploadCampos = upload.fields([
  { name: "foto", maxCount: 1 },
  { name: "pdf", maxCount: 1 },
  { name: "fotosExtra", maxCount: 12 },
]);

/* =========================================================================
   MIDDLEWARES
   ========================================================================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const emProducao = process.env.NODE_ENV === "production";
if (emProducao) app.set("trust proxy", 1); // necessário no Railway para cookies seguros funcionarem

app.use(
  session({
    secret: process.env.SESSION_SECRET || "troque-este-segredo-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: emProducao, // exige HTTPS em produção; localhost continua funcionando em HTTP
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  })
);

function apiAuth(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ erro: "Não autenticado." });
}

function paginaAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login.html");
}

/* =========================================================================
   ROTAS DE LOGIN
   ========================================================================= */
app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body;
  if (
    usuario &&
    senha &&
    usuario.toLowerCase() === ADMIN_USER.toLowerCase() &&
    senha === ADMIN_PASS
  ) {
    req.session.user = usuario;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, erro: "Usuário ou senha incorretos." });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/sessao", (req, res) => {
  res.json({ autenticado: !!req.session.user });
});

/* =========================================================================
   PÁGINA ADMIN PROTEGIDA
   (precisa vir ANTES do express.static para o middleware de auth valer)
   ========================================================================= */
app.get(["/admin", "/admin.html"], paginaAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* =========================================================================
   API DE EMBARCAÇÕES
   ========================================================================= */

// Lista pública (usada pelo site: index.html e embarcoes.html)
app.get("/api/boats", (req, res) => {
  const boats = db.prepare("SELECT * FROM boats ORDER BY id DESC").all();
  res.json(boats);
});

// Uma única embarcação (usada pela página de detalhe, embarcacao.html)
app.get("/api/boats/:id", (req, res) => {
  const boat = db.prepare("SELECT * FROM boats WHERE id = ?").get(req.params.id);
  if (!boat) return res.status(404).json({ erro: "Embarcação não encontrada." });
  res.json(boat);
});

// Criar embarcação (protegido) — aceita upload de foto, pdf e galeria de fotos extras
app.post(
  "/api/boats",
  apiAuth,
  uploadCampos,
  (req, res) => {
    const { modelo, ano, motorizacao, localizacao, condicao, descricao } = req.body;
    const foto = req.files?.foto?.[0] ? "img/" + req.files.foto[0].filename : req.body.fotoUrl || "";
    const pdf = req.files?.pdf?.[0] ? "pdfs/" + req.files.pdf[0].filename : "";
    const galeria = req.files?.fotosExtra?.length
      ? JSON.stringify(req.files.fotosExtra.map((f) => "img/" + f.filename))
      : "";

    const resultado = db
      .prepare(
        `INSERT INTO boats (modelo, ano, motorizacao, localizacao, foto, condicao, pdf, descricao, galeria)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(modelo, ano, motorizacao, localizacao, foto, condicao, pdf, descricao || "", galeria);

    const novo = db.prepare("SELECT * FROM boats WHERE id = ?").get(resultado.lastInsertRowid);
    res.json(novo);
  }
);

// Editar embarcação (protegido)
app.put(
  "/api/boats/:id",
  apiAuth,
  uploadCampos,
  (req, res) => {
    const atual = db.prepare("SELECT * FROM boats WHERE id = ?").get(req.params.id);
    if (!atual) return res.status(404).json({ erro: "Embarcação não encontrada." });

    const { modelo, ano, motorizacao, localizacao, condicao, descricao } = req.body;
    const foto = req.files?.foto?.[0] ? "img/" + req.files.foto[0].filename : atual.foto;
    const pdf = req.files?.pdf?.[0] ? "pdfs/" + req.files.pdf[0].filename : atual.pdf;
    // Enviar novas fotos extras substitui a galeria anterior; se não enviar nenhuma, mantém a atual
    const galeria = req.files?.fotosExtra?.length
      ? JSON.stringify(req.files.fotosExtra.map((f) => "img/" + f.filename))
      : atual.galeria;

    db.prepare(
      `UPDATE boats SET modelo=?, ano=?, motorizacao=?, localizacao=?, foto=?, condicao=?, pdf=?, descricao=?, galeria=?
       WHERE id=?`
    ).run(modelo, ano, motorizacao, localizacao, foto, condicao, pdf, descricao || "", galeria, req.params.id);

    const atualizado = db.prepare("SELECT * FROM boats WHERE id = ?").get(req.params.id);
    res.json(atualizado);
  }
);

// Remover embarcação (protegido)
app.delete("/api/boats/:id", apiAuth, (req, res) => {
  db.prepare("DELETE FROM boats WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================================
   ARQUIVOS ESTÁTICOS DO SITE (vem por último)
   (index.html na pasta public já é servido automaticamente em "/")
   ========================================================================= */
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
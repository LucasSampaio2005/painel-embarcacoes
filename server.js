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

// Cria a tabela com todas as novas colunas
db.prepare(`
CREATE TABLE IF NOT EXISTS boats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo TEXT,
  condicao TEXT,
  descricao TEXT,
  foto_principal TEXT,
  pdf TEXT,
  marca TEXT,
  ano TEXT,
  comprimento TEXT,
  casco TEXT,
  horas_motor TEXT,
  cabines TEXT,
  combustivel TEXT,
  banheiros TEXT,
  fotos_galeria TEXT
)`).run();

// Garante compatibilidade caso o banco já existisse sem as novas colunas
const colunasExistentes = db.prepare("PRAGMA table_info(boats)").all().map(c => c.name);
const novasColunas = [
  { nome: "descricao", tipo: "TEXT" },
  { nome: "foto_principal", tipo: "TEXT" },
  { nome: "marca", tipo: "TEXT" },
  { nome: "comprimento", tipo: "TEXT" },
  { nome: "casco", tipo: "TEXT" },
  { nome: "horas_motor", tipo: "TEXT" },
  { nome: "cabines", tipo: "TEXT" },
  { nome: "combustivel", tipo: "TEXT" },
  { nome: "banheiros", tipo: "TEXT" },
  { nome: "fotos_galeria", tipo: "TEXT" }
];

novasColunas.forEach(col => {
  if (!colunasExistentes.includes(col.nome)) {
    try {
      db.prepare(`ALTER TABLE boats ADD COLUMN ${col.nome} ${col.tipo}`).run();
    } catch (e) {
      // Coluna já existente ou ignorada
    }
  }
});

// Semeia o banco com os barcos do seed-boats.json na primeira execução
const totalBarcos = db.prepare("SELECT COUNT(*) AS n FROM boats").get().n;
if (totalBarcos === 0) {
  const seedPath = path.join(__dirname, "seed-boats.json");
  if (fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    const inserir = db.prepare(`
      INSERT INTO boats (
        modelo, condicao, descricao, foto_principal, pdf, 
        marca, ano, comprimento, casco, horas_motor, 
        cabines, combustivel, banheiros, fotos_galeria
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");
    seed.forEach((b) => {
      const fotoCapa = b.foto_principal || b.foto || "";
      const galeriaJson = Array.isArray(b.fotos_galeria) ? JSON.stringify(b.fotos_galeria) : "[]";
      inserir.run(
        b.modelo || "",
        b.condicao || "novo",
        b.descricao || "",
        fotoCapa,
        b.pdf || "",
        b.marca || "",
        b.ano || "",
        b.comprimento || "",
        b.casco || "",
        b.horas_motor || "",
        b.cabines || "",
        b.combustivel || "",
        b.banheiros || "",
        galeriaJson
      );
    });
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
    if (b.pdf.startsWith("pdfs/")) return;

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

// Aceita Foto Principal, PDF e múltiplas Fotos da Galeria
const uploadCampos = upload.fields([
  { name: "foto_principal", maxCount: 1 },
  { name: "foto", maxCount: 1 }, // suporte para legado
  { name: "pdf", maxCount: 1 },
  { name: "fotos_galeria", maxCount: 10 }
]);

/* =========================================================================
   MIDDLEWARES
   ========================================================================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const emProducao = process.env.NODE_ENV === "production";
if (emProducao) app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "troque-este-segredo-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: emProducao,
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
  
  // Converte a string de fotos_galeria de volta para Array JSON
  const formatados = boats.map(b => {
    let galeria = [];
    try {
      galeria = b.fotos_galeria ? JSON.parse(b.fotos_galeria) : [];
    } catch {
      galeria = [];
    }
    return {
      ...b,
      foto_principal: b.foto_principal || b.foto || "",
      fotos_galeria: galeria
    };
  });

  res.json(formatados);
});

// Criar embarcação (protegido)
app.post("/api/boats", apiAuth, uploadCampos, (req, res) => {
  const {
    modelo, condicao, descricao, tipo_apresentacao,
    marca, ano, comprimento, casco, horas_motor,
    cabines, combustivel, banheiros
  } = req.body;

  const arqFoto = req.files?.foto_principal?.[0] || req.files?.foto?.[0];
  const foto_principal = arqFoto ? "img/" + arqFoto.filename : "";

  // Se o usuário selecionou PDF como tipo de apresentação
  const pdf = tipo_apresentacao === "pdf" && req.files?.pdf?.[0]
    ? "pdfs/" + req.files.pdf[0].filename
    : (tipo_apresentacao === "pdf" ? req.body.pdf || "" : "");

  // Múltiplas fotos para a galeria
  let fotos_galeria = [];
  if (req.files?.fotos_galeria) {
    fotos_galeria = req.files.fotos_galeria.map(f => "img/" + f.filename);
  }

  const resultado = db
    .prepare(
      `INSERT INTO boats (
        modelo, condicao, descricao, foto_principal, pdf,
        marca, ano, comprimento, casco, horas_motor,
        cabines, combustivel, banheiros, fotos_galeria
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      modelo || "",
      condicao || "novo",
      descricao || "",
      foto_principal,
      pdf,
      marca || "",
      ano || "",
      comprimento || "",
      casco || "",
      horas_motor || "",
      cabines || "",
      combustivel || "",
      banheiros || "",
      JSON.stringify(fotos_galeria)
    );

  const novo = db.prepare("SELECT * FROM boats WHERE id = ?").get(resultado.lastInsertRowid);
  res.json({ ...novo, fotos_galeria });
});

// Editar embarcação (protegido)
app.put("/api/boats/:id", apiAuth, uploadCampos, (req, res) => {
  const atual = db.prepare("SELECT * FROM boats WHERE id = ?").get(req.params.id);
  if (!atual) return res.status(404).json({ erro: "Embarcação não encontrada." });

  const {
    modelo, condicao, descricao, tipo_apresentacao,
    marca, ano, comprimento, casco, horas_motor,
    cabines, combustivel, banheiros
  } = req.body;

  const arqFoto = req.files?.foto_principal?.[0] || req.files?.foto?.[0];
  const foto_principal = arqFoto ? "img/" + arqFoto.filename : (atual.foto_principal || atual.foto || "");

  let pdf = atual.pdf;
  if (tipo_apresentacao === "pdf") {
    if (req.files?.pdf?.[0]) {
      pdf = "pdfs/" + req.files.pdf[0].filename;
    }
  } else if (tipo_apresentacao === "detalhes") {
    pdf = ""; // Limpa o PDF caso o usuário mude para a opção de galeria/ficha técnica
  }

  let galeria = [];
  try {
    galeria = atual.fotos_galeria ? JSON.parse(atual.fotos_galeria) : [];
  } catch {
    galeria = [];
  }

  if (req.files?.fotos_galeria) {
    const novasFotos = req.files.fotos_galeria.map(f => "img/" + f.filename);
    galeria = [...galeria, ...novasFotos];
  }

  db.prepare(
    `UPDATE boats SET 
      modelo=?, condicao=?, descricao=?, foto_principal=?, pdf=?,
      marca=?, ano=?, comprimento=?, casco=?, horas_motor=?,
      cabines=?, combustivel=?, banheiros=?, fotos_galeria=?
     WHERE id=?`
  ).run(
    modelo ?? atual.modelo,
    condicao ?? atual.condicao,
    descricao ?? atual.descricao,
    foto_principal,
    pdf,
    marca ?? atual.marca,
    ano ?? atual.ano,
    comprimento ?? atual.comprimento,
    casco ?? atual.casco,
    horas_motor ?? atual.horas_motor,
    cabines ?? atual.cabines,
    combustivel ?? atual.combustivel,
    banheiros ?? atual.banheiros,
    JSON.stringify(galeria),
    req.params.id
  );

  const atualizado = db.prepare("SELECT * FROM boats WHERE id = ?").get(req.params.id);
  res.json({ ...atualizado, fotos_galeria: galeria });
});

// Remover embarcação (protegido)
app.delete("/api/boats/:id", apiAuth, (req, res) => {
  db.prepare("DELETE FROM boats WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================================
   ARQUIVOS ESTÁTICOS DO SITE (vem por último)
   ========================================================================= */
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
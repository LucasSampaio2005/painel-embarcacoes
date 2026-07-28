# Site + Painel Admin — Embarcações (Schaefer Yachts / Pércio Beraldo)

Site institucional com painel administrativo simples: agora as embarcações ficam
num banco de dados (SQLite) e o painel salva direto nele, sem precisar baixar
e substituir arquivo nenhum. Upload de fotos e PDFs é feito direto pelo formulário.

## Estrutura

```
server.js          -> backend Express (login, API de embarcações, upload)
seed-boats.json     -> dados iniciais (só usados na 1ª execução, para popular o banco)
boats.db            -> banco SQLite (criado automaticamente na 1ª execução)
public/
  index1.html        -> página inicial
  embarcoes.html      -> catálogo com filtros
  percio.html         -> página institucional
  login.html          -> login do painel
  admin.html          -> painel administrativo (protegido por login)
  style.css / style1.css / style2.css
  menu.js
  img/                -> fotos das embarcações (e imagens do site)
  pdfs/               -> PDFs de catálogo enviados pelo painel
```

## Rodando localmente

1. Instale o [Node.js](https://nodejs.org) versão **22.5 ou mais recente** (o banco de dados usa o
   módulo SQLite nativo do Node, que não precisa de nenhuma instalação extra nem de compilador).
2. Copie as imagens do site atual (logo, banner, fotos das embarcações, etc.)
   para a pasta `public/img/`.
3. No terminal, dentro desta pasta:

```bash
npm install
npm start
```

4. Acesse `http://localhost:3000` no navegador.
5. Para entrar no painel: `http://localhost:3000/login.html`

**Login padrão:** usuário `percio`, senha `schaefer2026`
(pode trocar via variáveis de ambiente — veja abaixo).

## Variáveis de ambiente (recomendado para produção)

Crie um arquivo `.env` (ou configure direto no Railway) com:

```
ADMIN_USER=percio
ADMIN_PASS=escolha-uma-senha-forte-aqui
SESSION_SECRET=uma-string-aleatoria-bem-grande
PORT=3000
```

Se essas variáveis não forem definidas, o servidor usa os valores padrão
(`percio` / `schaefer2026`) — troque isso antes de publicar o site de verdade.

## Deploy no Railway

1. Suba este projeto para um repositório no GitHub.
2. No Railway: **New Project → Deploy from GitHub repo**, selecione o repositório.
3. Em **Variables**, adicione `ADMIN_USER`, `ADMIN_PASS` e `SESSION_SECRET`
   (o Railway já define `PORT` sozinho).
4. O Railway detecta o `package.json` e roda `npm install` + `npm start` automaticamente.
5. **Importante:** o banco (`boats.db`) e as pastas `public/img` / `public/pdfs`
   ficam no disco do servidor. No plano gratuito do Railway o disco não é
   persistente entre deploys — para não perder as embarcações cadastradas,
   ative um **Volume** no Railway apontando para essas pastas, nas
   configurações do serviço.

## Como usar o painel

- Edite os campos de uma embarcação e clique em **Salvar** — grava direto no banco.
- Para trocar foto ou PDF, escolha o novo arquivo antes de salvar (se não escolher
  nada, o arquivo atual é mantido).
- Para adicionar uma embarcação nova, use o formulário no fim da página.
- **Remover** apaga a embarcação permanentemente do banco.

## Observações

- As fotos enviadas pelo painel vão para `public/img/`; os PDFs para `public/pdfs/`.
- O site (`index1.html` e `embarcoes.html`) busca as embarcações em `/api/boats`,
  então qualquer alteração feita no painel aparece no site imediatamente,
  sem precisar publicar nada de novo.

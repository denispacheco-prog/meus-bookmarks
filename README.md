# Meus Bookmarks

Ferramenta pessoal de bookmarks, inspirada no del.icio.us antigo. Uso individual, sem login.

## Como rodar localmente

Requer apenas Python 3 (nenhuma instalação de dependências):

```
python server.py
```

Depois acesse http://127.0.0.1:8000

## Estrutura

- `data/bookmarks.json` — todos os bookmarks, versionado no Git.
- `docs/` — frontend estático (HTML/CSS/JS puro). Fica em `docs/` (em vez de `public/`) porque é o nome que o GitHub Pages clássico espera para servir a partir da branch `main`.
- `server.py` — servidor local: serve o frontend e expõe `GET/POST/PUT/DELETE /api/bookmarks` e `POST /api/import` para ler e gravar em `data/bookmarks.json`. Só roda localmente.
- `docs/api-client.js` — camada de acesso a dados usada pelo frontend. Detecta automaticamente onde está rodando:
  - em `localhost`/`127.0.0.1`, chama a API local do `server.py`;
  - em qualquer outro domínio (GitHub Pages), chama a API do GitHub diretamente do navegador para ler/gravar `data/bookmarks.json`, criando um commit real a cada alteração.

## Publicando no GitHub Pages (acesso de qualquer computador)

1. **Habilitar o Pages**: no GitHub, em Settings → Pages → Source, escolha "Deploy from a branch", branch `main`, pasta `/docs`.
2. **Criar um Personal Access Token (fine-grained)**:
   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: apenas este repositório (`meus-bookmarks`).
   - Permissions: **Contents → Read and write**.
   - Gere e copie o token (ele só aparece uma vez).
3. **Configurar o token no site publicado**: abra o site no domínio do GitHub Pages, clique em "⚙ GitHub" na barra de ferramentas e cole o token. Ele fica salvo no `localStorage` do seu navegador — não é enviado a lugar nenhum além da API do próprio GitHub.
4. Pronto: adicionar, editar, remover e importar bookmarks pelo site publicado agora grava direto no `data/bookmarks.json` do repositório, via commit.

**Importante sobre segurança**: o token fica salvo em texto simples no `localStorage` do navegador usado para configurá-lo. Qualquer pessoa com acesso a esse navegador (ou às ferramentas de desenvolvedor dele) conseguiria lê-lo. Por isso o token é *fine-grained*, restrito só a este repositório e só com permissão de conteúdo — o pior cenário é alguém alterar seus bookmarks, não conseguir acesso a outros repositórios ou à sua conta.

Cada alteração feita pelo site publicado vira um commit no repositório (autor: o dono do token). Rodando localmente com `server.py`, nada disso se aplica — as alterações só ficam no arquivo local até você decidir commitar.

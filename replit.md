# Parallax Wallpaper

Aplicativo móvel offline-first para criar wallpapers com efeito de profundidade a partir de até três imagens.

## Run & Operate

- `pnpm install --frozen-lockfile` — instalar exatamente as dependências registradas no lockfile
- `pnpm --filter @workspace/parallax-wallpaper run dev` — iniciar o Metro/Expo para desenvolvimento e preview no Replit (`PORT` é injetado pelo workflow; fora dele, usa `24158`)
- `pnpm --filter @workspace/parallax-wallpaper run typecheck` — validar o TypeScript do app móvel
- `pnpm --filter @workspace/parallax-wallpaper run build` — gerar o bundle estático Expo para o fluxo de build existente
- `pnpm --filter @workspace/parallax-wallpaper run serve` — servir um bundle estático já gerado

O workflow `artifacts/parallax-wallpaper: expo` injeta `PORT` e os domínios de preview necessários. O app móvel não exige variáveis secretas, `DATABASE_URL`, PostgreSQL, API, servidor remoto ou armazenamento em nuvem.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54, React Native 0.81, Expo Router
- Persistência local: AsyncStorage
- Recursos nativos: galeria de imagens, haptics, sensores de movimento e remoção de fundo
- O workspace também contém artefatos auxiliares de API/DB e canvas, mas eles não fazem parte do caminho de execução do app móvel offline.

## Where things live

- `artifacts/parallax-wallpaper/app/index.tsx` — tela e fluxo principal do aplicativo
- `artifacts/parallax-wallpaper/app/_layout.tsx` — entrada do Expo Router, fontes, providers e navegação
- `artifacts/parallax-wallpaper/app.json` — configuração estática do Expo, identidade e plugins
- `artifacts/parallax-wallpaper/assets/` — ícone e assets empacotados
- `artifacts/parallax-wallpaper/server/` — servidor opcional para bundles estáticos; não é necessário no dispositivo
- `lib/api-client-react`, `lib/api-zod`, `lib/db` e `artifacts/api-server` — workspace de backend compartilhado/opcional, não usado pelo app offline

## Architecture decisions

- O estado do projeto é salvo localmente em `AsyncStorage`, permitindo continuar sem conexão.
- Imagens são escolhidas e processadas no dispositivo; o app não envia fotos para uma API.
- O efeito Parallax usa transformações locais e `DeviceMotion` quando disponível.
- A remoção de fundo usa a biblioteca nativa local e mantém um fallback quando o recurso não é suportado.

## Product

O usuário importa imagens para camadas de fundo, intermediária e frontal, ajusta posição/escala e parâmetros visuais, remove fundos quando suportado, salva o projeto localmente e visualiza/aplica o wallpaper usando os recursos do sistema Android.

## User preferences

- O funcionamento principal deve permanecer inteiramente offline no dispositivo móvel.
- Não adicionar PostgreSQL, `DATABASE_URL`, API remota, armazenamento em nuvem ou outro serviço online como requisito.
- Preservar o workspace pnpm e a arquitetura existente; evitar migrações e refatorações sem necessidade.

## Gotchas

- O preview do Replit é um preview Expo/Metro; para testar sensores, galeria, remoção de fundo e aplicação do wallpaper é necessário um dispositivo Android ou build nativo.
- O `DeviceMotion` é ignorado no web preview.
- Os workflows de API e canvas são auxiliares e não devem ser iniciados para desenvolver o app offline.
- A configuração inicial do Android está em `app.json` com o identificador `com.parallaxwallpaper.app`; confirme esse identificador antes da primeira publicação, pois ele deve permanecer estável depois.
- A publicação na Google Play exige um fluxo de build Android nativo separado do preview Expo do Replit.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

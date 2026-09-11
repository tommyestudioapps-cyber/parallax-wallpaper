# Roteiro de teste fotográfico

Quatro fotos cobrem todos os cenários de distorção conhecidos. Preparar antes da rodada de QA.

## Foto 1 — Retrato sem EXIF

- Origem: qualquer screenshot de celular, ou foto exportada sem metadados.
- Dimensão: pelo menos 1080×1920.
- Objetivo: validar o caso mais simples. Nenhum mecanismo de correção precisa entrar em ação.

## Foto 2 — Paisagem sem EXIF

- Origem: qualquer imagem exportada horizontalmente, sem metadados.
- Dimensão: pelo menos 1920×1080.
- Objetivo: validar que a camada cobre a tela em orientação retrato sem distorção.

## Foto 3 — Com crop retangular

- Origem: usar uma das duas fotos acima.
- Aplicar no editor um crop com proporção bem diferente da original (ex.: crop quadrado em foto retrato).
- Objetivo: validar que a blindagem UV preserva a proporção do crop.

## Foto 4 — EXIF orientation 6 ou 8

- Origem: foto tirada por um celular que grava orientação no EXIF (a maioria dos Androids atuais).
- Verificar no PC que o EXIF tem `Orientation = 6` ou `8` (via `exiftool` ou similar).
- Se não tiver, aplicar EXIF manualmente com `exiftool -Orientation=6 <arquivo>`.
- Objetivo: validar o `ExifOrientationHelper` e a blindagem UV.

## Como usar cada foto

Para cada uma das 4:

1. Configurar composição no app usando a foto como camada de fundo.
2. Aplicar o wallpaper.
3. Observar durante 10 segundos de movimento suave.
4. Registrar em `scripts/qa/logs/<timestamp>.md`:
   - Alongou horizontalmente? (sim / não)
   - Alongou verticalmente? (sim / não)
   - Enquadramento condiz com o esperado? (sim / não)

## Fotos de referência

Salvar as 4 fotos em `scripts/qa/photos/` para que a mesma amostra seja usada em cada rodada. Nomes sugeridos:

- `01-portrait-no-exif.jpg`
- `02-landscape-no-exif.jpg`
- `03-crop-rectangular.jpg`
- `04-exif-orientation-6.jpg`
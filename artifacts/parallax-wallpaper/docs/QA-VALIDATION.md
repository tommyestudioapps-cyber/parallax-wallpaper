# QA — Validação do Parallax Wallpaper

Documento vivo. Atualizar sempre que um comportamento documentado mudar.

## Pré-requisitos

- Build de release instalada nos dois OPPO A78 (mesma APK, mesmo artefato).
- `adb` disponível na máquina do testador.
- Pelo menos 4 fotos preparadas (ver `docs/QA-PHOTO-TESTS.md`).
- Modo de desenvolvedor ativo no aparelho (para Logcat via USB).

## Captura de Logcat

Antes de cada rodada, limpar e iniciar captura:

```bash
./scripts/qa/capture-logcat.sh start
```

Após cada cenário, parar a captura:

```bash
./scripts/qa/capture-logcat.sh stop
```

O script salva o Logcat em `scripts/qa/logs/<timestamp>.log`.

## Checklist de validação

Cada item abaixo é binário: passa ou falha. Registrar o resultado em `scripts/qa/logs/<timestamp>.md` (o script de captura cria esse arquivo).

### 1. Instalação

- [ ] Wallpaper aparece no seletor do Android em ambos os aparelhos.
- [ ] Aplicar o wallpaper funciona em ambos.

### 2. Visual — sem distorção

Testar com as 4 fotos de `docs/QA-PHOTO-TESTS.md`:

- [ ] Foto retrato sem EXIF — sem alongamento.
- [ ] Foto paisagem sem EXIF — sem alongamento.
- [ ] Foto com crop retangular — enquadramento correto.
- [ ] Foto com EXIF orientation 6 ou 8 — sem alongamento.

Repetir em ambos os aparelhos.

### 3. Movimento

- [ ] Girar aparelho no eixo Y (roll) desloca camadas horizontalmente.
- [ ] Girar aparelho no eixo X (pitch) desloca camadas verticalmente.
- [ ] Direção do deslocamento é a mesma nos dois aparelhos.
- [ ] Amplitude do deslocamento respeita a intensidade configurada.

### 4. Rotação de tela

- [ ] Girar 90° com wallpaper visível redesenha imediatamente.
- [ ] Parallax volta a funcionar em menos de 1 segundo após rotação.

### 5. Modo economia de bateria

- [ ] Ativar economia de bateria e bloquear/desbloquear tela.
- [ ] Parallax continua funcionando (resposta mais "digital" é esperada).

### 6. Mudança dinâmica de composição

- [ ] Com wallpaper ativo, alterar composição no app.
- [ ] Wallpaper atualiza automaticamente ao voltar para a home.

### 7. Trim de memória

- [ ] Rodar app pesado por 2–3 min com wallpaper em background.
- [ ] Voltar para home — wallpaper redesenha corretamente.

### 8. Bateria

- [ ] Deixar wallpaper aplicado por 30 min sem interação.
- [ ] Consumo do app abaixo de 3% em 30 min com tela apagada.

### 9. Mipmaps

- [ ] Camada de fundo com `scale` muito abaixo de 1 (zoom out acentuado).
- [ ] Sem "serrilhado" ou "cintilação" durante movimento.

### 10. Logcat em release

- [ ] Nenhuma linha `PARALLAX_ENGINE_CREATED` ou `PARALLAX_GL_RENDERER_READY` (gate de logs funcionando).
- [ ] Nenhum `PARALLAX_GL_RENDER_ERROR` em uso normal.
- [ ] Nenhum `PARALLAX_RENDERER_FALLBACK` em uso normal.

## Interpretação de logs de erro

Se aparecer em release, é diagnóstico real:

| Log | Significado | Ação |
|---|---|---|
| `PARALLAX_RENDERER_FALLBACK reason=egl_initialization` | Thread EGL não inicializou | Verificar se é transitório. Retry automático deve resolver. |
| `PARALLAX_RENDERER_FALLBACK reason=egl_swap_buffers` | Falha no swap | Driver em estado ruim. Se persistir, capturar `PARALLAX_EGL_EXTENSIONS` da build de debug. |
| `PARALLAX_GPU_FAILURE reason=...` | Notificação de falha chegou ao serviço | Wallpaper fica preto até retry. Anotar frequência. |
| `PARALLAX_GL_RENDER_ERROR error=0x...` | Erro silencioso do driver GL | Correlacionar com cenário. Se recorrente, é bug de driver. |
| `PARALLAX_COMPOSITION_FAILED` | JSON de composição inválido | Verificar a fonte do JSON no lado JS. |

## Comparação entre os dois OPPO A78

Preencher ao final de cada rodada:

| Item | Aparelho 1 | Aparelho 2 |
|---|---|---|
| Wallpaper aparece no seletor | | |
| Sem distorção nas 4 fotos | | |
| Direção do parallax | | |
| Rotação de tela OK | | |
| Modo economia OK | | |
| Consumo em 30 min | | |
| Logcat limpo | | |

Divergência entre aparelhos em qualquer item indica causa hardware/firmware, não código. Capturar Logcat completo de ambos no mesmo cenário para análise.
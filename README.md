# Agent Usage Monitor

Widget flotante mínimo para Windows con dos celdas lado a lado: **Claude** y **Codex**. Cada una muestra el porcentaje usado de su ventana primaria de cinco horas, la cuenta atrás y la hora local exacta de reinicio.

La ventana permanece visible, es arrastrable y solo incluye el control para cerrar, visible al pasar el cursor. Sigue el tema claro u oscuro de Windows y cambia con él. Si Claude todavía no está conectado, aparece una acción discreta para instalar el colector `statusLine` autorizado.

## Fuentes y privacidad

- Claude: JSON oficial entregado al comando `statusLine`; el colector guarda únicamente el porcentaje y reinicio de cinco horas, un identificador técnico de snapshot y su timestamp.
- Codex: `account/rateLimits/read` del `codex app-server` oficial.
- No lee credenciales OAuth, contenido de chats, títulos ni sesiones. No usa APIs metered.
- Un dato ausente se muestra como `sin dato` y uno vencido como `stale`; nunca se inventa 0 %.
- Tiempo real: Claude cambia al momento con cada `statusLine` de Claude Code; Codex se consulta cada 15 s sobre un único app-server persistente.

## Desarrollo

Requiere Windows 10/11 y Node.js 22+.

```bash
npm install
npm test
npm run check
npm run test:visual
npm run dist
```

# AGENTS.md — Circuito Urbano Online

Documentación de referencia para agentes que trabajen en este repositorio:
**estado actual del juego**, su arquitectura y las mejoras planificadas.

---

## 1. Resumen del proyecto

Juego de carreras 3D estilo arcade ("Circuito Urbano") hecho con Three.js, con
dos modos:

- **Solo**: carrera contra el reloj por un circuito urbano cerrado (3 vueltas
  por defecto) esquivando obstáculos.
- **En línea (LAN)**: carrera de **2 a 4 jugadores** en red local. Lobby y
  señalización por WebSocket, y poses de los coches (20 Hz) por **WebRTC
  DataChannel "UDP-like"** en topología de **malla** (cada navegador se
  conecta P2P con los demás). No requiere internet ni servidores externos;
  Three.js se carga desde CDN.

Flujo de uso completo, instalación e instrucciones de conectividad LAN
(`ipconfig`) en **`README.md`**.

## 2. Archivos

| Archivo | Rol |
| --- | --- |
| `index.html` | Estructura de la página: HTML + importmap de Three.js + `<script type="module" src="js/main.js">`. |
| `css/style.css` | Hoja de estilos del juego (HUD, menús, pantallas de resultado). |
| `js/main.js` | Todo el juego en un módulo ES: escena, física, HUD, red. |
| `server.js` | Sirve la página por HTTP y actúa como señalización WebSocket (lobby, relay de ofertas WebRTC, eventos). Requiere `ws`. |
| `package.json` | `start: node server.js`, dependencia `ws ^8.18.0`. |
| `README.md` | Guía de instalación, ejecución y conexión LAN para usuarios. |
| `package-lock.json` / `.gitignore` | Lockfile e ignores (evita `node_modules`). |

## 3. Estado actual (hecho y verificado)

### 3.1 Circuito y escena
- Pista cerrada con `CatmullRomCurve3` (`trackPoints`, curva `curve`).
- Ancho controlado por **`TRACK_WIDTH = 28`** (constante en un solo lugar;
  `halfW = TRACK_WIDTH / 2`). OJO: **los obstáculos NO escalan su lateral con
  el ancho** (siguen en ±3/±3.5), ver mejoras.
- Generación síncrona al cargar (top-level del módulo): asfalto (textura por
  canvas con línea discontinua central), bordes rojo/blanco (`createBorders`),
  línea start/finish, 8 checkpoints invisibles (`checkpointCount = 8`,
  distancia de activación `dist < TRACK_WIDTH`), 150 edificios, 100 árboles,
  farolas (cada `t += 0.05`, ambos lados a `halfW + 3`) y conos de tráfico
  (`t` 0.15–0.85 en pasos de 0.08, a `halfW - 1`).
- Minimapa (`drawMinimap`) con coche, dirección, obstáculos y línea de meta.

### 3.2 Física y controles (constantes)
- `MAX_SPEED = 90` (la reversa se limita a `-30%`), `ACCEL = 40`,
  `BRAKE = 55`, `FRICTION = 12`, `TURN_SPEED = 2.4`, `CAR_Y = 0.5`.
- Controles: `W/A/S/D` y flechas; `R` reubica el coche en la pista (usa
  `getClosestTrackT`).
- Fuera de pista: `isOnTrack` (radio `halfW + 1`) aplica penalización suave
  (fricción `×0.98`, tope 15).
- Edificios: `checkBuildingCollision` (rebote `speed *= -0.3`) — colisión
  invisible contra los hoteles.

### 3.3 Obstáculos y colisiones
- Lista fija `OBSTACLE_POSITIONS` (≈24 entradas `[t, lateral, type]`, laterales
  ±3/±3.5). `createObstacle` a partir de `posOnTrack(t, lateral)`.
- Tipos en física (`checkObstacleCollision`): `block` (hornacina de cemento,
  r1.5), `barrel` (r1.4), `barrier` (r1.8) y `oil` (r2.5).
- Sólidos → rebote `speed *= -0.25` + empuje fuera (`radius - dist` × 0.8).
- **Aceite** NO cuenta como colisión: fija `oilSlideTimer = 1.5` (derrape:
  control 0.45, aceleración mitad, fricción menor, desliz extra).

### 3.4 Penalización por colisiones (implementado)
- Estado: `collisionCount`, `collisionCooldown = 0.6`, `penaltyTimer`.
- **Cada 3 impactos acumulados** con obstáculos sólidos → `penaltyTimer = 1.5`
  y el contador vuelve a 0. No cuenta durante la penalización activa.
- Mientras `penaltyTimer > 0`: `speed = 0`, sin girar ni acelerar/frenar
  (`penalized` inhabilita las entradas en `animate`).
- Banner `#penalty-message` ("PENALIZACIÓN" + `Inmovilizado N.N s`) visible
  solo mientras dura, sincronizado en `updateHUD`.
- Reset del estado de colisiones en `startCountdown`.

### 3.5 Modo en línea (arquitectura de red)
- **Servidor** (`server.js`, puerto `8080`, `env PORT`):
  - Sirve la página del juego por HTTP (estáticos: `/`, `css/`, `js/`) e integra
    el WebSocket en el mismo puerto (modo `noServer` + `upgrade`).
  - `MAX_PLAYERS = 4`; 4 colores por orden de conexión:
    `[0x3366ff, 0xff3333, 0x33cc66, 0xff9900]`.
  - Mensajes: `welcome`, `roster` (broadcast), `role` (promoción de host),
    `leave`, relay `{t:'relay', from, msg}` (ofrecido/answer/ice/finish),
    `start` (solo host y con ≥2 jugadores), `ping`→`pong`, `error`
    (sala llena).
  - Imprime sus URLs HTTP y WS al arrancar (`http://ip:8080`, `ws://ip:8080`).
- **Cliente** (`js/main.js`, marcado `// ═══════ RED LOCAL ═══════`; estructuras
  HTML en `index.html`):
  - Variables globales: `mode`, `netSocket`, `myId`, `myColor`, `netName`,
    `isHost`, `peers` (Map id→`{pc, channel}`), `roster` (excluye a mí),
    `remotePlayers` (Map id→`{group, poses, lap, progress, name, color}`),
    `remoteFinishTimes`, `resultsTimer`, `pingMs`, `INTERP_DELAY = 120`,
    `POSE_INTERVAL = 50`.
  - `connectOnline()` → `hello` → `welcome` (id, color, host) + `roster`.
  - **Malla P2P**: `syncPeers()` asegura un `RTCPeerConnection` por rival; el
    de **menor id** crea el DataChannel `'pose'` (`{ordered:false,
    maxRetransmits:0}`) y la offer (anti-glare). `ensurePeer` /
    `onOffer` / `onAnswer` / `onIce` todo por-peer (no hay `peer` global).
  - **Poses**: `sendPose()` difunde a todos los canales abiertos cada 50 ms
    `{x, z, yaw, speed, lap, progress}`. Interpolación con buffer de ~120 ms
    (`updateRemoteCars`), posición circular (rueda) derivada de la velocidad.
  - Coches rivales: `createRemoteCar(color)` — misma geometría que el local,
    offset lateral inicial al arrancar; `paintLocalCar` pinta el coche local
    con el color asignado por el servidor.
  - Posición en vivo: `onlinePositionText()` (score = lap + progress).
  - Fin de carrera: al cruzar la meta se envía `finish` a **todos**; los
    tiempos remotos se almacenan por jugador (`remoteFinishTimes`); el
    marcador (`#results`) sale cuando **todos** terminaron, con **fallback de
    25 s** (quienes no llegan salen como DNF). `results-back` hace
    `location.reload()`.
  - Desconexión: `leave` → `removeRemotePlayer` (quita coche y cierra su peer);
    durante una carrera activa se termina la partida (aviso + reload). Si el
    host se va, el servidor promueve a otro (mensaje `role`).
  - HUD online: Ping (WS ping/pong cada 2 s) y Posición.
  - Estado de conexión: `setNetStatus` / `updateNetStatus`
    ("Conexión P2P: N/M").

### 3.6 UI / HUD
- Pantalla inicial con menú (CARRERA SOLA / JUGAR EN LÍNEA), panel online
  (IP, nombre, CONECTAR/VOLVER, INICIAR CARRERA solo host), cuenta regresiva,
  banner de penalización, mensaje de vuelta, resultados online, HUD (tiempo,
  vuelta, mejor vuelta, ping, posición), barra de velocidad y minimapa.

## 4. Convenciones del código

- Comentarios y textos de UI en **español**; nombres de variables/funciones en
  **inglés** (camelCase).
- Juego separado en tres archivos cliente: `index.html` (estructura HTML +
  `importmap` de Three.js r160 vía CDN), `css/style.css` (estilos) y
  `js/main.js` (un único `<script type="module" src="js/main.js">`).
- Los estilos inline del HTML están convertidos a clases en `css/style.css`
  (p. ej. `.label.mt`, `.value.small`, `.btn-row`, `#net-start`).
- Secciones marcadas con barras: `// ─── NOMBRE ───` y
  `// ═══════ NOMBRE ═══════`.
- La escena se construye de forma síncrona al cargar (top-level) **independiente
  de la red**: para config de partida online será necesario refactorizar (ver
  mejoras).
- Lógica de checkpoints: `checkInOrder` + `passedStart`; `startCountdown`
  centraliza todos los resets (física, vuelta, red, colisiones).

## 5. Verificación (comandos usados habitualmente)

- Sintaxis del módulo del cliente: `node --check js/main.js`.
- Sintaxis del servidor: `node --check server.js`.
- Smoke test HTTP: levantar `node server.js` y comprobar respuesta 200 de `/`,
  `/css/style.css` y `/js/main.js` (el navegador los resuelve por la misma URL).
- Prueba de señalización: script Node temporal que levanta `node server.js`
  y simula 4 clientes `ws` (host, rosters, relay entre pares, ping/pong,
  solo-host inicia, sala llena, promoción de host, leave). P2P WebRTC no es
  testeable headless: se valida por revisión lógica.
- Arranque del servidor: `npm start` o `node server.js` (imprime HTTP y WS).
- `npm install` tras clonar/actualizar deps.

## 6. Mejoras a futuro (roadmap)

### 6.1 PRIORIDAD 1 — Parámetros de partida desde el servidor (seguridad/antitrampa)
Propósito: que la configuración del juego (ancho de pista, vueltas, obstáculos
y físicas) **la emita el servidor al inicio de la partida**, de modo que un
cliente no pueda alterar los archivos recibidos (`js/main.js`) para cambiar las
reglas en línea. Desde que el servidor sirve la página por HTTP, todos los
jugadores reciben ya el mismo código, pero las constantes de partida siguen
fijas en el cliente.

Diseño propuesto (aún NO implementado):
- Añadir un config autoritativo en `server.js`
  (ej. `{trackWidth, totalLaps, obstacleCount, maxSpeed, accel, brake,
  friction, turnSpeed, carY, seed}`) con valores por defecto que reflejen las
  constantes del cliente (`js/main.js`, sección `// ─── CONFIG ───`).
- El **host configura** en el lobby: tamaño de autopista y cantidad de
  obstáculos (y opcionalmente vueltas). Nuevo mensaje `{t:'settings', config}`
  → el servidor **valida y clampa** rangos razonables (sugerencia: `trackWidth`
  16–36, `obstacleCount` 8–40, `totalLaps` 1–10) y responde/broadcast un
  `{t:'meta', config}` en vivo. Solo `isHost` puede enviar `settings`.
- En `{t:'start'}` el servidor genera un `seed` común y broadcast final
  `{t:'start', ts, config}`; **todos los clientes aplican el mismo config** en
  modo online, ignorando los valores locales.
- Cliente:
  - Sustituir las constantes por un objeto `gameConfig` que en modo online se
    sobreescribe desde el mensaje del servidor (física del `animate`, `lap-val`,
    `currentLap > totalLaps`, `halfW` de pista/puntos de control/`isOnTrack`).
  - Refactorizar la creación de pista/bordes/línea de salida/conos/farolas/
    obstáculos en `buildWorld(cfg)` + `disposeWorld()`, ya que hoy se genera
    síncrono con constantes fijas al cargar.
  - **Seed común** (p. ej. PRNG *mulberry32*) para que el layout de obstáculos
    sea idéntico en todos los jugadores (fairness), incluyendo `obstacleCount`.
- Limitación esperable: sin simulación autoritativa por servidor de las
  físicas, un jugador que reescriba los archivos que recibe del servidor podría
  redefinir el motor del juego; el objetivo es impedir trampas *de
  configuración*, no proteger contra una reedición completa del cliente.

### 6.2 Repartir obstáculos según el ancho de pista
Hoy los laterales son fijos (±3/±3.5) mientras `TRACK_WIDTH = 28`; las curvas
de pista quedan despejadas y los obstáculos amontonados en el centro. Escalar
el lateral por `TRACK_WIDTH / 14` (o factor configurable) al construir.

### 6.3 Mejoras de producto (candidatas)
- Guardado de mejores tiempos en `localStorage`.
- Efectos de sonido (motor, colisión, penalización, checkpoints).
- Selección de más circuitos (varios `trackPoints`).
- Coche fantasma (tu mejor vuelta).
- Bots en modo solo (se probó en una iteración anterior y se retiró).
- Simulación autoritativa en servidor de físicas (a medio plazo, antitrampa
  total; coste alto).
- Continuar la carrera si un rival se desconecta (hoy termina la partida).
- Reconexión a mitad de partida.
- Sistema de música/UI de ajustes persistente en `localStorage`.
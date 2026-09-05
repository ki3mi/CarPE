# Circuito Urbano Online

Juego de carreras 3D con Three.js y multijugador en red local (LAN) para 2, 3 o 4 jugadores.

- **Modo solo**: carrera contra el cronómetro contra obstáculos (barriles, bloques, vallas y parches de aceite).
- **Modo en línea**: carrera de 2 a 4 jugadores por la red local (malla P2P). Lobby + señalización vía WebSocket y poses de los coches en tiempo real por WebRTC DataChannel (UDP-like), que solo depende de la LAN, sin internet ni servidores externos.

## Requisitos

- [Node.js](https://nodejs.org/) instalado (versión 14 o superior). Se usa únicamente para el servidor de señalización.
- Navegador moderno (Chrome, Edge, Firefox) con WebRTC habilitado (todos lo traen por defecto).
- 2 a 4 PCs en la **misma red local** (o el mismo PC abriendo varias pestañas/ventanas).

Three.js se carga desde CDN, por lo que los navegadores necesitan conexión a internet para cargar la librería. El juego en sí funciona en LAN.

## Instalación

1. Descarga o clona la carpeta del proyecto (donde están `index.html`, `server.js` y `package.json`).
2. Abre una terminal en esa carpeta e instala la dependencia del servidor:

```bash
npm install
```

Esto instala `ws`, la librería de WebSockets usada por el servidor.

## Ejecución

### 1) Arrancar el servidor de señalización (solo en el PC host)

```bash
npm start
# o bien: node server.js
```

Al arrancar verás algo como:

```
=== Servidor de señalización: Circuito Urbano Online ===
Escuchando en el puerto 8080
   ws://192.168.0.21:8080
   ws://192.168.253.1:8080     <- (puede haber varias direcciones, usa la real)
```

El servidor actúa como lobby y puente de señalización WebRTC. No transmite el juego: las poses de los coches se envían directamente entre los dos navegadores por WebRTC.

### 2) Abrir el juego en cada PC

Abre el archivo `index.html` en el navegador, tanto en el PC host como en el invitado.

### 3) Conectarse

1. En el PC **anfitrión**, pulsa **JUGAR EN LÍNEA**. El campo "IP del host" puede dejarse en `127.0.0.1` (esa IP siempre apunta al propio equipo). Pulsa **CONECTAR**.
2. En el PC **invitado**, pulsa **JUGAR EN LÍNEA**, escribe la **IP LAN del host** (ver sección siguiente) y pulsa **CONECTAR**.
3. El primer jugador conectado es el host. Entra el **host y todos los participantes** (mínimo 2). Cuando haya al menos 2 jugadores en sala, el host verá el botón **INICIAR CARRERA** (puede esperar a tener 3 o 4). Todos ven "Sala lista: N jugadores".
4. Pulsa **INICIAR CARRERA** y la cuenta regresiva empieza en ambas PC a la vez.

> Nota: si se desconecta el host durante el juego, otro jugador pasa a ser host automáticamente. Si alguien abandona la sala durante la carrera, la carrera termina para los demás.

## Cómo saber tu IP LAN (con ipconfig)

Para que el invitado se conecte necesita la dirección IP local del host. En **Windows**, abre una terminal y ejecuta:

```bash
ipconfig
```

Busca la sección del adaptador de red activo (Wi-Fi o Ethernet, la que estés usando para conectarte a la red):

```
Adaptador de LAN inalámbrica Wi-Fi:

   Dirección IPv4. . . . . . . . . . . . . : 192.168.0.21
   Máscara de subred . . . . . . . . . . . : 255.255.255.0
   Puerta de enlace predeterminada . . . . . : 192.168.0.1
```

- La **Dirección IPv4** es la IP LAN del host: asígnala en el invitado, p. ej. `192.168.0.21`.
- Escoge una IP que sea **privada** (normalmente `192.168.x.x`, `10.x.x.x` o `172.16.x.x`–`172.31.x.x`) y que **no** comience por `169.254` (eso indica que no hay red).
- El servidor también imprime sus IPs disponibles al arrancar (`ws://192.168.0.21:8080`).

En **Linux/macOS** usa equivalente:

```bash
ip a
# o
ifconfig
```

> Solución de problemas: si el invitado no conecta, comprueba que el firewall del host permite el puerto **8080**, que ambos están en la misma red, y que el puerto no está bloqueado por el router/aislamiento de cliente (AP isolation).

## Controles

| Tecla | Acción |
| --- | --- |
| W / ↑ | Acelerar |
| S / ↓ | Frenar / Reversa |
| A / ← | Girar izquierda |
| D / → | Girar derecha |
| R | Reiniciar posición en el circuito |

Objetivo: completar **3 vueltas**. Cuidado con los obstáculos; los parches de aceite reducen el agarre y el control del coche.

## Clasificación en línea

Durante la carrera verás en la pantalla tu **Ping** (ms) y tu **Posición** en vivo entre todos los participantes. Al llegar, se avisa quién cruza la meta; el marcador aparece cuando **todos** terminan (con un espera máxima de 25 s para los que no llegan, que cuentan como DNF). La sincronización de cada rival usa interpolación de 120 ms sobre las poses enviadas a 20 Hz.

## Archivos

| Archivo | Descripción |
| --- | --- |
| `index.html` | El juego completo (escena, coche, físicas, HUD, red). Ábrelo en el navegador. |
| `server.js` | Lobby y señalización WebRTC (WebSocket en el puerto 8080). |
| `package.json` | Configuración del proyecto e instalación de `ws`. |
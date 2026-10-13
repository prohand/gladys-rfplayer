# Integración RFPlayer

Conecte un **Ziblue / GCE Electronics RFPlayer RFP1000** (433 y 868 MHz) a
Gladys: sensores y detectores de radio, mandos e interruptores de pared, y los
receptores que controla la llave (enchufes, luces, persianas Somfy RTS, portones).

## 1. Exponer la llave por TCP

La integración se ejecuta en un contenedor aislado que **no puede abrir un puerto
USB**. El RFPlayer sigue conectado a un equipo de su red (el equipo de Gladys,
una Raspberry Pi…), y un pequeño «puente serie-TCP» hace accesible su puerto
serie en la red. Los datos son los mismos, a 115200 baudios.

Busque el nombre estable de la llave:

```bash
ls -l /dev/serial/by-id/
```

### Con ser2net 4 (Debian 11+, Raspberry Pi OS)

```bash
sudo apt install ser2net
```

`/etc/ser2net.yaml`:

```yaml
connection: &rfplayer
  accepter: tcp,4000
  enable: on
  options:
    kickolduser: true
  connector: serialdev,/dev/serial/by-id/usb-XXXX-if00-port0,115200n81,local
```

Sustituya la ruta `/dev/serial/by-id/...` por la suya y después ejecute
`sudo systemctl restart ser2net`.

### Con ser2net 3

`/etc/ser2net.conf`:

```
4000:raw:0:/dev/serial/by-id/usb-XXXX-if00-port0:115200 8DATABITS NONE 1STOPBIT
```

### Con socat (prueba rápida)

```bash
socat TCP-LISTEN:4000,reuseaddr,fork FILE:/dev/serial/by-id/usb-XXXX-if00-port0,b115200,raw,echo=0
```

> El puente **no tiene contraseña**: quien llegue al puerto controla sus
> dispositivos de radio. Manténgalo en su red local y nunca lo redirija a
> Internet. Con ser2net puede vincularlo a una sola dirección:
> `accepter: tcp,192.168.1.10,4000`.

## 2. Configurar la integración

| Campo                                   | Qué indicar                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Host del puente                         | IP del equipo que ejecuta el puente. Para el propio equipo de Gladys, su **IP local** — `localhost` es el propio contenedor. |
| Puerto TCP del puente                   | `4000` en los ejemplos anteriores.                                                                                           |
| Protocolos recibidos                    | Vacío para todos. Desmarque lo que no use para captar menos vecinos.                                                         |
| Calidad de radio mínima                 | 0 lo conserva todo; 3 o 4 descarta los emisores lejanos (de los vecinos).                                                    |
| Umbral de detección de interferencias   | 7 por defecto; 1 = muy sensible, 10 = necesita un inhibidor en ambas bandas, 0 = desactivado.                                |
| Identificar las sondas Oregon / OWL por | «Dirección» (por defecto) o «Modelo y canal» — vea más abajo.                                                                |
| Actuadores                              | Los receptores que controla la llave — vea la sección 4.                                                                     |
| Tipos de detectores                     | Qué detector es un contacto de puerta, un detector de humo… — vea la sección 3.                                              |

Pulse **Probar la conexión**: muestra el modelo, el firmware, el tiempo de
respuesta y los protocolos recibidos, además de cualquier error en sus ajustes.

## 3. Sensores, detectores y mandos (recibidos)

Nada que declarar: en cuanto la llave recibe un dispositivo, aparece en la
pestaña **Descubrir**. Cree los que son suyos — las sondas de los vecinos también
se reciben, simplemente se quedan ahí. Los valores y los disparadores de escena
solo llegan a los dispositivos que ha creado.

- **Sondas Oregon Scientific**: temperatura, humedad, presión, velocidad y
  dirección del viento, lluvia, UV. Medidores **OWL**: potencia (por fase en el
  CM180i) y energía. Las sondas Oregon eligen una nueva dirección aleatoria en
  cada cambio de pilas. Con «Dirección», dos sondas idénticas en el mismo canal
  se distinguen, pero un cambio de pilas crea un dispositivo nuevo. Con «Modelo y
  canal», el dispositivo sobrevive a los cambios de pilas, siempre que cada sonda
  de un modelo esté configurada en su propio canal. Cambiar este ajuste crea
  dispositivos nuevos.
- **Detectores Visonic y X2D**: alarma, sabotaje y pila baja. Por radio, un
  contacto de puerta parece un detector de movimiento, así que indíqueselo a la
  integración en **Tipos de detectores**, p. ej.
  `VISONIC 1166992416 = opening; X2D 7894561 = smoke` (tipos: `motion`,
  `opening`, `smoke`, `leak`, `vibration`, `presence`). El id se muestra en el
  widget y en los parámetros del dispositivo. Los detectores de movimiento y de
  humo nunca envían «ha terminado»: su alarma vuelve a 0 al cabo de 1 a 2 minutos.
- **Detectores de humo KD101**: la alerta.
- **Mandos e interruptores de pared** (Chacon/DiO, X10, Domia, Blyss, Somfy RTS,
  X2D, llaveros Visonic, FS20…): el dispositivo muestra la última orden de
  encendido/apagado (subir/my/bajar en un mando RTS), y cada pulsación dispara el
  disparador de escena **Se pulsa un mando de radio** con la orden exacta.

## 4. Actuadores (controlados por la llave)

Un receptor no puede descubrirse por radio: declárelo. La forma más sencilla es
el botón **Emparejar un actuador**:

1. ponga el receptor en modo aprendizaje (pulse el botón de un enchufe Chacon,
   mantenga PROG en el mando original de una persiana Somfy RTS hasta que dé un
   pequeño movimiento…);
2. indique un nombre, el tipo, el protocolo y una dirección libre (0 a 255, o A1
   a P16), y después ejecute la acción;
3. la llave envía la trama de emparejamiento y el receptor se añade al campo
   **Actuadores**. Créelo desde la pestaña **Descubrir**.

También puede escribir el campo a mano, con las entradas separadas por `;`:

```
Living room shutter = shutter RTS 1; Desk lamp = switch CHACON 12; Hall = light X10 A3; Gate = button RTS 2 qualifier=1
```

| Tipo      | Qué hace                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| `switch`  | Encender / apagar.                                                                               |
| `light`   | Encender / apagar y brillo (protocolos con orden de atenuación: X10, reguladores Chacon, FS20…). |
| `shutter` | Abrir / parar / cerrar. En Somfy RTS, parar es el botón «my».                                    |
| `button`  | Una única orden (portón, puerta de garaje, timbre). Un portón RTS necesita `qualifier=1`.        |

La dirección no es la de su antiguo mando: la llave la combina con su propio
identificador, de modo que el `ID 1` de su RFPlayer nunca controla un dispositivo
de un vecino. Las órdenes de radio nunca se confirman: Gladys muestra lo que ha
enviado.

## 5. Escenas y panel (Gladys 5.1+)

Disparadores:

- **Se pulsa un mando de radio** — filtro por el mando y la orden; variables:
  nombre, orden, protocolo, dirección.
- **Se dispara un detector de radio** — alarma o sabotaje.
- **Pila baja en un dispositivo de radio**.
- **Interferencia de radio** — iniciada o terminada. Un inhibidor es la forma
  clásica de cegar una alarma inalámbrica: cree una escena de notificación con él.

Acciones:

- **Enviar una orden de radio** — cualquier orden a cualquier dirección, incluso
  una no declarada (un segundo canal, el «my» de RTS…). Su salida `sent` es false
  cuando la llave no está conectada.
- **Simular una interferencia de radio** — para probar su escena de alarma de
  principio a fin.

El widget **Radio RFPlayer** muestra si la llave está conectada, el estado de
interferencia, los contadores y los últimos emisores recibidos, con una insignia
que indica si cada uno ya es un dispositivo en Gladys.

## Solución de problemas

- **«RFPlayer inaccesible»**: compruebe el puente (`systemctl status ser2net`),
  la IP y el puerto, y que ningún otro programa ocupe el puerto serie
  (`kickolduser` ayuda con ser2net). Desde otro equipo:
  `nc 192.168.1.10 4000` y después escriba `ZIA++HELLO` + Intro: la llave responde
  `ZIA--Welcome to Ziblue Dongle…`.
- **Conectada y después inaccesible cada minuto**: el puerto del puente está
  abierto pero la llave no responde al PING — desconectada, o con otra velocidad
  en baudios.
- **No se ve un mando**: ¿está marcado su protocolo en «Protocolos recibidos»?
  ¿Es demasiado alta la calidad mínima? El widget lista lo que se recibe, creado o
  no.
- **Una persiana no se mueve**: debe emparejarse una vez (sección 4). En RTS, la
  persiana debe estar en modo programación (PROG mantenido en su mando) cuando se
  envía la trama de emparejamiento.
- **Demasiados dispositivos en Descubrir**: suba la calidad de radio mínima y
  desmarque los protocolos que no use.
